"""Tests for the upgraded /api/dashboard (Task 2.2).

Seeds two users + feedback into an in-memory SQLite DB and asserts the new
shapes: by_session, heatmap, stuck. Auth + DB session are overridden so the
test runs offline with no Google/Postgres.
"""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.main import app
from app.db import get_session
from app.auth import current_user
from app import cache
from app.models import User, Progress, Feedback


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    admin_email = "callum@bikeluggage.co.uk"
    learner_email = "immy@bikeluggage.co.uk"

    with Session(engine) as s:
        s.add(User(email=admin_email, name="Callum", is_admin=True))
        s.add(User(email=learner_email, name="Immy", is_admin=False))
        # Immy: completed s1_immy (session 1), said 'no' confidence -> stuck + low_conf
        s.add(Progress(user_email=learner_email, persona="immy",
                       mission_id="s1_immy", session=1))
        s.add(Feedback(user_email=learner_email, persona="immy",
                       mission_id="s1_immy", session=1,
                       confidence="no", stars=1, applied=False))
        # Callum: completed c1 (session 2), confident, applied -> not stuck
        s.add(Progress(user_email=admin_email, persona="callum",
                       mission_id="c1", session=2))
        s.add(Feedback(user_email=admin_email, persona="callum",
                       mission_id="c1", session=2,
                       confidence="yes", stars=3, applied=True))
        s.commit()

    def _override_session():
        # mirror production (db.get_session): expire_on_commit=False so ORM
        # attributes stay readable after the session scope, as the route expects.
        with Session(engine, expire_on_commit=False) as s:
            yield s

    def _override_user():
        # the dashboard caller is the admin; return a detached, fully-populated
        # User so no lazy attribute refresh is attempted after the request.
        return User(email=admin_email, name="Callum", is_admin=True)

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[current_user] = _override_user
    cache.invalidate("dashboard")  # start clean each test
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        cache.invalidate("dashboard")


def test_dashboard_has_new_shapes(client):
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    body = r.json()
    for key in ("by_session", "heatmap", "stuck",
                "progress", "feedback", "applied_total", "not_yet_total"):
        assert key in body


def test_by_session_counts(client):
    body = client.get("/api/dashboard").json()
    bs = body["by_session"]
    # session 1: one completion, one low_conf (Immy said 'no')
    assert bs["1"]["completed"] == 1
    assert bs["1"]["low_conf"] == 1
    # session 2: one completion, no low confidence
    assert bs["2"]["completed"] == 1
    assert bs["2"]["low_conf"] == 0


def test_heatmap_cells(client):
    body = client.get("/api/dashboard").json()
    cells = body["heatmap"]
    assert {"persona", "mission_id", "confidence", "stars"} <= set(cells[0].keys())
    pairs = {(c["persona"], c["mission_id"]) for c in cells}
    assert ("immy", "s1_immy") in pairs
    assert ("callum", "c1") in pairs


def test_stuck_flags_low_confidence(client):
    body = client.get("/api/dashboard").json()
    stuck = body["stuck"]
    assert {"name", "persona", "mission_id", "reason"} <= set(stuck[0].keys())
    immy = [s for s in stuck if s["mission_id"] == "s1_immy"]
    assert immy and immy[0]["reason"] == "confidence=no"
    # Callum (confident) is not stuck
    assert not any(s["mission_id"] == "c1" for s in stuck)
