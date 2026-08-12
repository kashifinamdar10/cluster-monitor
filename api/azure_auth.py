"""
Databricks Azure AD authentication — zero-dependency HTTP implementation.

Uses raw urllib.request directly to Azure AD endpoints.
The device code flow is stateless: the device_code is returned to the
frontend on initiation and passed back on every poll call.  No server-side
session dictionary is needed.

Scope: Databricks resource in Azure AD (2ff814a6-…).
Public client: Azure CLI well-known client (04b07795-…), which supports
the device code flow without a custom app registration.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

# Databricks resource in Azure AD — grants access to workspace & account APIs
DATABRICKS_SCOPE = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default"

# Azure CLI well-known public client — supports device code flow without
# requiring a custom app registration in the user's tenant.
AZURE_PUBLIC_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"


def _post(url: str, body: dict, timeout: int = 15) -> dict:
    """POST form-encoded body to Azure AD and return parsed JSON."""
    data = urllib.parse.urlencode(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_bytes = exc.read()
        try:
            detail = json.loads(body_bytes)
            msg = detail.get("error_description") or detail.get("error") or str(detail)
        except (json.JSONDecodeError, KeyError):
            msg = body_bytes.decode(errors="replace")
        raise RuntimeError(msg) from exc


def start_device_flow(tenant_id: str, client_id: str = AZURE_PUBLIC_CLIENT_ID) -> dict:
    """
    Start the Azure AD device code flow for Databricks access.

    Returns device_code, user_code, verification_uri, expires_in, interval.
    device_code is opaque and should be returned to the frontend so that
    polling is stateless — no server-side session dictionary is needed.
    """
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode"
    result = _post(url, {"client_id": client_id, "scope": DATABRICKS_SCOPE})
    if "user_code" not in result:
        raise RuntimeError(
            result.get("error_description") or result.get("error") or str(result)
        )
    return {
        "device_code":      result["device_code"],
        "user_code":        result["user_code"],
        "verification_uri": result["verification_uri"],
        "expires_in":       int(result.get("expires_in", 900)),
        "interval":         int(result.get("interval", 5)),
        "message":          result.get("message", ""),
    }


def poll_device_flow(tenant_id: str, client_id: str, device_code: str) -> dict:
    """
    Poll Azure AD for an OAuth token using a device code (stateless).

    Returns a dict with key "status":
        "pending"  — user hasn't signed in yet (keep polling)
        "success"  — authenticated; dict also has access_token, refresh_token, token_expires_at
        "expired"  — device code has expired
        "error"    — unexpected error; dict also has "message"
    """
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
        "client_id":   client_id,
        "device_code": device_code,
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
        if access_token := result.get("access_token"):
            expires_in = int(result.get("expires_in", 3600))
            return {
                "status":           "success",
                "access_token":     access_token,
                "refresh_token":    result.get("refresh_token", ""),
                "token_expires_at": int(time.time()) + expires_in,
            }
        return {"status": "error", "message": str(result)}

    except urllib.error.HTTPError as exc:
        try:
            err = json.loads(exc.read())
        except Exception:
            return {"status": "error", "message": str(exc)}
        error_code = err.get("error", "")
        if error_code == "authorization_pending":
            return {"status": "pending"}
        if error_code in ("expired_token", "code_expired", "authorization_declined"):
            return {"status": "expired", "message": err.get("error_description", error_code)}
        return {"status": "error", "message": err.get("error_description", str(err))}


def refresh_oauth_token(tenant_id: str, client_id: str, refresh_token: str) -> dict:
    """
    Use a stored refresh_token to silently acquire a new access token.
    Returns {"access_token", "refresh_token", "token_expires_at"} on success.
    Raises RuntimeError on failure.
    """
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    result = _post(url, {
        "grant_type":    "refresh_token",
        "client_id":     client_id,
        "refresh_token": refresh_token,
        "scope":         DATABRICKS_SCOPE,
    })
    if "access_token" not in result:
        raise RuntimeError(
            result.get("error_description") or result.get("error") or str(result)
        )
    expires_in = int(result.get("expires_in", 3600))
    return {
        "access_token":     result["access_token"],
        "refresh_token":    result.get("refresh_token", refresh_token),
        "token_expires_at": int(time.time()) + expires_in,
    }
