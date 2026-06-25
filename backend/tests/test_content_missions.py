import json
import pathlib

from app.content_schema import validate_content

DOC = json.loads(
    (pathlib.Path(__file__).parents[1] / "app/missions.json").read_text()
)


def test_missions_file_is_valid():
    assert validate_content(DOC) == []


def test_four_sessions_present():
    assert set(DOC["sessions"].keys()) == {"1", "2", "3", "4"}


def test_every_mission_has_apply():
    for ms in DOC["missions"].values():
        for m in ms:
            assert m["apply"]["q"]
            # TRACE is global; mission must not opt out
            assert m.get("kind") in ("standard", "build")


def test_no_codex_toolguide_remains():
    assert "toolGuide" not in DOC
    # belt and braces: no mission carries a stray toolGuide key either
    for ms in DOC["missions"].values():
        for m in ms:
            assert "toolGuide" not in m


def test_missions_endpoint_has_sessions_and_glossary():
    """Task 2.1: /api/missions serves the v2 shape (sessions + glossary, no
    toolGuide). The route is public, so no auth override is needed."""
    from fastapi.testclient import TestClient
    from app import cache
    from app.main import app

    cache.invalidate("missions")  # avoid a stale v1-shaped cache entry
    body = TestClient(app).get("/api/missions").json()
    assert "sessions" in body
    assert "glossary" in body
    assert "toolGuide" not in body
