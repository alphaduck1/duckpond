"""Caching layer — Redis (Cloud Memorystore) with in-memory fallback.

Used to keep hot reads fast: missions content, the admin dashboard
aggregate, and the pending-proposals list. If REDIS_URL is unset or the
server is unreachable, we transparently fall back to a small in-process
cache so the app never hard-fails on a cache problem.
"""
import json
import time
from typing import Optional
from .config import get_settings

settings = get_settings()

_redis = None
_mem: dict[str, tuple[float, str]] = {}     # key -> (expires_at, json)


def _client():
    global _redis
    if _redis is not None:
        return _redis
    if not settings.redis_url:
        return None
    try:
        import redis  # lazy import
        _redis = redis.Redis.from_url(
            settings.redis_url, socket_timeout=0.5, socket_connect_timeout=0.5
        )
        _redis.ping()
        return _redis
    except Exception:
        _redis = None
        return None


def get(key: str):
    """Return cached JSON-decoded value or None."""
    r = _client()
    if r is not None:
        try:
            raw = r.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            pass
    # in-memory fallback
    item = _mem.get(key)
    if item and item[0] > time.time():
        return json.loads(item[1])
    if item:
        _mem.pop(key, None)
    return None


def set(key: str, value, ttl: int = 60):
    """Cache a JSON-serialisable value for ttl seconds."""
    payload = json.dumps(value, default=str)
    r = _client()
    if r is not None:
        try:
            r.setex(key, ttl, payload)
            return
        except Exception:
            pass
    _mem[key] = (time.time() + ttl, payload)


def invalidate(*keys: str):
    r = _client()
    if r is not None:
        try:
            for k in keys:
                r.delete(k)
        except Exception:
            pass
    for k in keys:
        _mem.pop(k, None)
