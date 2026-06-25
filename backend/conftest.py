"""Make the `app` package importable as `from app...` when running pytest from
the backend/ directory (the app package lives at backend/app)."""
import os
import sys
from pathlib import Path

# Use a local SQLite DB for tests so importing app.main / running startup never
# tries to reach Postgres. Set BEFORE any `app.*` import reads settings.
os.environ.setdefault("DATABASE_URL", "sqlite://")

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
