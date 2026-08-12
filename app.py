"""Entry point for the Cluster Monitor Databricks App.

Builds the React frontend if dist/ is missing (first deploy or clean checkout),
then starts the FastAPI server via uvicorn.
"""
import os
import subprocess
import sys


def _project_root() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def build_frontend_if_needed() -> None:
    root = _project_root()
    dist_index = os.path.join(root, "dist", "index.html")
    frontend_dir = os.path.join(root, "frontend")

    if os.path.exists(dist_index):
        print("Frontend dist/ already built — skipping npm build.")
        return

    if not os.path.isdir(frontend_dir):
        print("WARNING: frontend/ directory not found; skipping build.", file=sys.stderr)
        return

    print("Building React frontend (npm install + vite build)…")
    try:
        subprocess.run(
            ["npm", "install", "--prefix", frontend_dir, "--prefer-offline"],
            check=True,
        )
        subprocess.run(
            ["npm", "run", "build", "--prefix", frontend_dir],
            check=True,
        )
        print("Frontend build complete.")
    except subprocess.CalledProcessError as e:
        print(f"Frontend build failed: {e}", file=sys.stderr)
        # Continue anyway — API endpoints still work without the UI


if __name__ == "__main__":
    build_frontend_if_needed()

    import uvicorn

    port = int(os.environ.get("DATABRICKS_APP_PORT", 8000))
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        # Single worker — Databricks Apps is single-process; workers > 1 would
        # cause Lakebase token-refresh thread to be duplicated per worker.
        workers=1,
    )
