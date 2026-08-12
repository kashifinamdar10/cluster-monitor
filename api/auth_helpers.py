"""Shared auth helpers — lock + credential-isolated SDK client factories.

The Databricks app always has DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET
in its environment (its own app-level SP).  When we need to construct a client
with *different* credentials (user-configured SP or bearer token) the SDK raises
"more than one authorization method configured" if it sees both sets.

The helpers below temporarily suppress the app SP env vars inside a module-level
lock so that the SDK only sees the credentials we explicitly pass.  Both
compute.py and main.py import the lock from here to ensure mutual exclusion
across the entire process.
"""
import os
import threading

_sdk_env_lock = threading.Lock()

# All Databricks env vars that could bleed into an isolated SDK client and
# cause auth conflicts. We suppress ALL of them before constructing any
# client with explicit credentials, then restore them afterwards.
_APP_SP_KEYS = (
    "DATABRICKS_HOST",
    "DATABRICKS_WORKSPACE_ID",
    "DATABRICKS_ACCOUNT_ID",
    "DATABRICKS_CLIENT_ID",
    "DATABRICKS_CLIENT_SECRET",
    "DATABRICKS_TOKEN",
    "DATABRICKS_AZURE_CLIENT_ID",
    "DATABRICKS_AZURE_CLIENT_SECRET",
    "DATABRICKS_AZURE_TENANT_ID",
)


def workspace_client_sp(host: str, client_id: str, client_secret: str, timeout_s: int = 30):
    """WorkspaceClient using *only* the supplied SP credentials.

    ``timeout_s`` is forwarded via Config so that individual HTTP requests do
    not hang indefinitely on unreachable hosts.
    """
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.config import Config
    with _sdk_env_lock:
        saved = {k: os.environ.pop(k) for k in _APP_SP_KEYS if k in os.environ}
        try:
            cfg = Config(
                host=host,
                client_id=client_id,
                client_secret=client_secret,
                http_timeout_seconds=timeout_s,
            )
            client = WorkspaceClient(config=cfg)
        finally:
            os.environ.update(saved)
    return client


def account_client_sp(account_id: str, client_id: str, client_secret: str, timeout_s: int = 30):
    """AccountClient using *only* the supplied SP credentials."""
    from databricks.sdk import AccountClient
    from databricks.sdk.config import Config
    with _sdk_env_lock:
        saved = {k: os.environ.pop(k) for k in _APP_SP_KEYS if k in os.environ}
        try:
            cfg = Config(
                host="https://accounts.azuredatabricks.net",
                account_id=account_id,
                client_id=client_id,
                client_secret=client_secret,
                http_timeout_seconds=timeout_s,
            )
            client = AccountClient(config=cfg)
        finally:
            os.environ.update(saved)
    return client
