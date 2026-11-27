"""Entrypoint khởi chạy máy chủ FastAPI cho LibMate."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn


def main() -> None:
    host = os.environ.get("LIBMATE_HOST", "0.0.0.0")
    port = int(os.environ.get("LIBMATE_PORT", "8000"))
    reload_enabled = os.environ.get("LIBMATE_RELOAD", "false").lower() == "true"
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=reload_enabled, ws="none")


if __name__ == "__main__":
    main()

