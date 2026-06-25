"""Tests for the read-only build-sandbox engine.

The model call is stubbed (`_call_model`) so every run is deterministic and
offline, and so we can prove the engine never touches the network or any system.
"""
import pytest

from app.sandbox import list_templates, run_template


# Exact step names, sourced from missions.json build blocks.
EXPECTED_STEPS = {
    "content-batch": ["research", "draft", "self-check"],
    "page-loop": ["check-page", "flag-or-fix", "next-page-until-clean"],
    "fitment-verify": ["intake", "compatibility-check", "rule-out-reasons", "draft-reply"],
}


def test_templates_cover_the_three_build_missions():
    ids = {t["id"] for t in list_templates()}
    assert {"content-batch", "page-loop", "fitment-verify"} <= ids


def test_template_metadata_shape():
    for t in list_templates():
        assert set(t.keys()) == {"id", "title", "persona", "steps", "editable"}
        assert isinstance(t["steps"], list) and t["steps"]
        assert isinstance(t["editable"], list)
        # step names match the authored workflow exactly
        assert t["steps"] == EXPECTED_STEPS[t["id"]]


def test_run_content_batch_returns_steps_and_trace_prompt(monkeypatch):
    monkeypatch.setattr("app.sandbox._call_model", lambda prompt: "stub output")
    out = run_template(
        "content-batch",
        {"topic": "winter luggage", "tone": "practical"},
        "abbie@bikeluggage.co.uk",
    )
    assert [s["name"] for s in out["steps"]] == ["research", "draft", "self-check"]
    assert all(s["output"] == "stub output" for s in out["steps"])
    assert all("flagged" in s for s in out["steps"])
    assert "trace_prompt" in out and out["trace_prompt"]


def test_run_page_loop_step_names(monkeypatch):
    monkeypatch.setattr("app.sandbox._call_model", lambda prompt: "ok")
    out = run_template(
        "page-loop",
        {"tone_rule": "friendly, no hype", "stop_condition": "all pages clean"},
        "emyr@bikeluggage.co.uk",
    )
    assert [s["name"] for s in out["steps"]] == EXPECTED_STEPS["page-loop"]


def test_run_fitment_verify_step_names(monkeypatch):
    monkeypatch.setattr("app.sandbox._call_model", lambda prompt: "ok")
    out = run_template(
        "fitment-verify",
        {"bike_intake": "Triumph Tiger 900 2021", "policy_rule": "30-day returns"},
        "immy@bikeluggage.co.uk",
    )
    assert [s["name"] for s in out["steps"]] == EXPECTED_STEPS["fitment-verify"]


def test_output_filter_flags_unverifiable_facts(monkeypatch):
    # Simulate the model hallucinating a specific price/SKU; the engine must flag it.
    monkeypatch.setattr(
        "app.sandbox._call_model",
        lambda prompt: "The TR46 pannier is just £8799 — buy now!",
    )
    out = run_template("content-batch", {"topic": "panniers", "tone": "punchy"}, "x@y.co")
    assert any(s["flagged"] for s in out["steps"])


def test_unknown_template_raises():
    with pytest.raises(ValueError):
        run_template("nope", {}, "x@y.co")
