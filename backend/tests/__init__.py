"""Pytest test suite for LibMate backend (Unit, Integration, Concurrency, Security, and Regression TC01-TC32)."""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
