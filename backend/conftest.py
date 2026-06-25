"""Make the `app` package importable as `from app...` when running pytest from
the backend/ directory (the app package lives at backend/app)."""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
