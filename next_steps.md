# Next Steps — Resume Point

## Where We Left Off

Replacing the non-functional "Browser OAuth" (device flow) in the Settings → Workspaces tab
with a simpler **Personal Access Token (PAT)** option.

### Why the device flow doesn't work
The Databricks OIDC device authorization endpoint (`/oidc/accounts/{id}/v1/deviceAuthorization`)
returns a **303 redirect** to the login page instead of a JSON device_code/user_code response.
`databricks-cli` is not a registered public client that supports server-side device flow on
Azure Databricks — it expects a real browser redirect (PKCE), not a direct POST.

### Why Account Admin is required regardless
The Account API endpoint used for workspace discovery (`GET /api/2.0/accounts/{id}/workspaces`)
requires **Account Admin** privileges. A regular user with a valid token will get a 403. This is
true for both SP auth and any OAuth/PAT approach. Confirmed account ID: `827e3e09-89ba-4dd2-9161-a3301d0f21c0`.

---

## What Needs to Be Done

### 1. Replace "Browser OAuth" with "Personal Access Token" in the UI

**File:** `frontend/src/components/SettingsPage.tsx`

The `AuthMethod` type was already changed from `'sp' | 'oauth'` → `'sp' | 'pat'` and the pill
label was updated to "Personal Access Token". The remaining work:

- **Remove** the dead OAuth state/types:
  - `OAuthStep` type
  - `OAuthFlowData` interface
  - `oauthStep`, `oauthFlow`, `oauthError`, `pollTimerRef` state
  - `handleOAuthStart`, `pollOAuth`, `handleOAuthDisconnect`, `handleOAuthCancel` functions
  - The `useRef` import (if no longer used elsewhere)

- **Add** PAT state:
  - `patAccountId: string` (pre-populated from `settings.account_oauth_account_id` on load)
  - `patToken: string` (empty — never pre-filled for security; placeholder says "already saved" if active)
  - `patSaveStatus: 'idle' | 'saving' | 'saved' | 'error'`

- **Add** PAT handlers:
  - `handlePatSave()` — POST to `/api/auth/pat` with `{account_id, token}`
  - `handlePatDisconnect()` — DELETE to `/api/auth/oauth` (same endpoint as before)

- **Replace** the OAuth UI block (`{authMethod === 'oauth' && ...}`) with a PAT form:
  - Account ID text input (mono, UUID format)
  - PAT input (type="password")
  - "Save Token" button + save status badge
  - "Disconnect" link (shown when `settings.account_oauth_active`)
  - Info callout explaining:
    - How to generate a PAT: Workspace → Settings → Developer → Access Tokens
    - That Account Admin is required to discover workspaces across the account
    - Token is stored server-side; only the account ID is shown after saving

- Update `hasWorkspaceAccess` to use `settings.account_oauth_active` (already correct)
- Update the on-load effect: when `account_oauth_active`, set `authMethod('pat')` instead
  of `'oauth'` and seed `patAccountId` from `account_oauth_account_id`

### 2. Add `POST /api/auth/pat` backend endpoint

**File:** `api/main.py`

```python
class PatPayload(BaseModel):
    account_id: str
    token: str

@app.post("/api/auth/pat")
def post_pat(payload: PatPayload):
    """Store a Personal Access Token for cross-workspace access."""
    global _current_settings
    if not payload.token.strip():
        raise HTTPException(status_code=400, detail="token is required")
    _current_settings.account_oauth = AccountOAuthToken(
        account_id=payload.account_id.strip(),
        access_token=payload.token.strip(),
        token_type="Bearer",
    )
    save_settings(_current_settings)
    return {"ok": True}
```

The existing `DELETE /api/auth/oauth` endpoint already handles clearing — no change needed.

### 3. Build + deploy

```bash
cd frontend && npm run build
cd .. && databricks bundle deploy --target dev
```

---

## State of the Code Right Now

- `AuthMethod` type: already `'sp' | 'pat'` ✓
- Pill label: already "Personal Access Token" ✓
- OAuth state/handlers: **still present** — needs cleanup
- Backend `POST /api/auth/pat`: **not yet added**
- The dead device-flow backend endpoints (`/api/auth/device-start`, `/api/auth/device-poll`)
  can be left in place or removed — they're unused but harmless

---

## Other Pending Items (lower priority)

- End-to-end History tab test — enable storage, trigger refreshes, verify state changes
- Cluster detail drawer — click row → side panel with full config
- Terminate / restart cluster action with confirmation dialog
- Warehouse start / stop quick-action buttons
- Global search / free-text filter across all tabs
- Export to CSV
- SSE reconnect logic — max-retry counter + "reconnecting…" banner
- Error boundary — prevent full page blank on component crash
