from app.content_schema import validate_content


def _base_mission() -> dict:
    return {
        "id": "s1_abbie",
        "session": 1,
        "tier": "core",
        "kind": "standard",
        "phase": "Session 1 · Foundations",
        "colour": "#E7654A",
        "title": "t",
        "real": "r",
        "learn": {"concept": "c", "body": "b"},
        "steps": [{"n": "Step 1", "h": "h", "p": "p"}],
        "doIt": "Do this in Claude.",
        "prompt": "p",
        "spot": {
            "q": "q",
            "good": {"txt": "g", "correct": True, "verdict": "v"},
            "bad": {"txt": "b", "correct": False, "verdict": "v"},
        },
        "quiz": [{"q": "q", "opts": ["a", "b"], "a": 0, "ex": "e"}],
        "apply": {"q": "q", "placeholder": "p"},
        "keep": {"label": "l", "desc": "d", "text": "t"},
    }


def _base_doc(mission: dict, persona: str = "abbie") -> dict:
    return {
        "sessions": {"1": {"week": 1, "title": "x", "goal": "y", "concepts": ["z"]}},
        "people": {"abbie": {"name": "Abbie", "role": "Marketing", "colour": "#E7654A"}},
        "trace": [["T", "Traceable", "desc", "#000"]],
        "glossary": {"agentic": {"short": "s", "analogy": "a"}},
        "missions": {persona: [mission]},
    }


def _doc_with_kind(kind: str, build=None) -> dict:
    m = _base_mission()
    m["kind"] = kind
    if build is not None:
        m["build"] = build
    else:
        m.pop("build", None)
    return _base_doc(m)


def _doc_with_persona_key(persona: str) -> dict:
    return _base_doc(_base_mission(), persona=persona)


def test_minimal_valid_doc_passes():
    doc = {
        "sessions": {"1": {"week": 1, "title": "x", "goal": "y", "concepts": ["z"]}},
        "people": {"abbie": {"name": "Abbie", "role": "Marketing", "colour": "#E7654A"}},
        "trace": [["T", "Traceable", "desc", "#000"]],
        "glossary": {"agentic": {"short": "s", "analogy": "a"}},
        "missions": {"abbie": [{
            "id": "s1_abbie", "session": 1, "tier": "core", "kind": "standard",
            "phase": "Session 1 · Foundations", "colour": "#E7654A",
            "title": "t", "real": "r",
            "learn": {"concept": "c", "body": "b"},
            "steps": [{"n": "Step 1", "h": "h", "p": "p"}],
            "doIt": "Do this in Claude.",
            "prompt": "p",
            "spot": {"q": "q", "good": {"txt": "g", "correct": True, "verdict": "v"},
                              "bad": {"txt": "b", "correct": False, "verdict": "v"}},
            "quiz": [{"q": "q", "opts": ["a", "b"], "a": 0, "ex": "e"}],
            "apply": {"q": "q", "placeholder": "p"},
            "keep": {"label": "l", "desc": "d", "text": "t"}
        }]}
    }
    assert validate_content(doc) == []


def test_build_mission_requires_build_block():
    doc = _doc_with_kind("build", build=None)   # helper builds a one-mission doc
    errs = validate_content(doc)
    assert any("build" in e for e in errs)


def test_unknown_persona_key_flagged():
    doc = _doc_with_persona_key("nobody")
    errs = validate_content(doc)
    assert any("persona" in e for e in errs)
