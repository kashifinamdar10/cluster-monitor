"""Symmetric encryption helpers for at-rest secret protection.

The SETTINGS_ENCRYPTION_KEY environment variable must contain a valid Fernet
key (32 url-safe base64 bytes).  Generate one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If the env var is absent the helpers are no-ops — plaintext is returned
unchanged — so existing deployments continue to work until the key is set.
Once the key is configured, all new writes are encrypted.  Existing plaintext
values are migrated automatically on the next save.

Encrypted values are prefixed with ``enc:`` so the code can distinguish
ciphertext from legacy plaintext, and from values that were never set.
"""

import os

_ENV_KEY = "SETTINGS_ENCRYPTION_KEY"
_PREFIX = "enc:"


def _fernet():
    """Return a Fernet instance if a key is configured, else None."""
    raw = os.getenv(_ENV_KEY, "").strip()
    if not raw:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(raw.encode())
    except Exception as exc:
        import sys
        print(
            f"WARNING: {_ENV_KEY} is set but could not be loaded: {exc}. "
            "Secrets will not be encrypted.",
            file=sys.stderr,
        )
        return None


def encrypt_secret(plaintext: str) -> str:
    """Encrypt *plaintext* and return ``enc:<ciphertext>``.

    Returns *plaintext* unchanged if:
    - the value is empty / None
    - SETTINGS_ENCRYPTION_KEY is not configured
    - the value is already encrypted (idempotent)
    """
    if not plaintext:
        return plaintext or ""
    if plaintext.startswith(_PREFIX):
        return plaintext  # already encrypted
    f = _fernet()
    if f is None:
        return plaintext
    return _PREFIX + f.encrypt(plaintext.encode()).decode()


def decrypt_secret(value: str) -> str:
    """Decrypt an ``enc:<ciphertext>`` value back to plaintext.

    Returns *value* unchanged if:
    - the value is empty / None
    - the value has no ``enc:`` prefix (legacy plaintext — pass-through)
    - SETTINGS_ENCRYPTION_KEY is not configured
    Returns ``""`` if the key is set but decryption fails (wrong key or
    corrupted data) so the app doesn't crash on a bad secret.
    """
    if not value:
        return value or ""
    if not value.startswith(_PREFIX):
        return value  # legacy plaintext — no prefix
    f = _fernet()
    if f is None:
        # Key not configured; return value as-is (won't be usable as a secret,
        # but the app can still start and show a configuration warning).
        return value
    try:
        from cryptography.fernet import InvalidToken
        return f.decrypt(value[len(_PREFIX):].encode()).decode()
    except Exception:
        import sys
        print(
            "WARNING: Failed to decrypt client_secret — wrong SETTINGS_ENCRYPTION_KEY "
            "or corrupted data. The stored secret has been cleared.",
            file=sys.stderr,
        )
        return ""


def is_encryption_enabled() -> bool:
    """Return True if a valid encryption key is configured."""
    return _fernet() is not None
