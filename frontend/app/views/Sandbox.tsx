"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Sandbox.tsx  —  the Session-4 build-sandbox UI (plan Task 3.5).
//
// IMPORT PATH:  import Sandbox from "@/app/views/Sandbox";   (or "../views/Sandbox" from page.tsx)
//
// PROPS:  { mission, trace, onComplete }
//   - mission   : the active kind:"build" mission object from data.missions[persona].
//                 Reads mission.build = { template, editable[], steps[], validateWith }.
//   - trace     : data.trace — the 5-letter TRACE rubric, passed straight through to <TraceWidget>.
//   - onComplete: (missionId, feedback) => void — same signature page.tsx already uses for the
//                 standard Mission view (confidence/stars/applied/quiz/note). Sandbox calls it
//                 when the learner finishes (TRACE scored + reflection answered).
//
// NEW API CALL FOR THE INTEGRATOR (add to lib/api.ts):
//   async sandboxTemplates() { return (await req("/api/sandbox/templates")).json(); }
//     -> { templates: [{ id, title, persona, steps[], editable[] }] }   (auth required, NOT admin)
//   async sandboxRun(template_id: string, params: Record<string,string>) {
//     return (await req("/api/sandbox/run", {
//       method: "POST",
//       body: JSON.stringify({ template_id, params }),
//     })).json();
//   }
//     -> { steps: [{ name, output, flagged[] }], trace_prompt }   (auth required, NOT admin)
//   Unknown template_id -> HTTP 404 (surface as an error message).
//
// Until the integrator wires those in, this file degrades gracefully: if `api.sandboxRun`
// (or `api.sandboxTemplates`) is missing it shows a clear inline notice instead of crashing.
//
// Reuses existing globals.css classes: card, phase, stepcard, sn, promptbox, apply, keep,
// btn / ghost / sm, feedback, scorechip, eyebrow, crumbs, mono, etc. No new global styles.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import TraceWidget from "../components/TraceWidget";

type BuildBlock = {
  template: string;
  editable: string[];
  steps: string[];
  validateWith?: string;
};

type RunStep = { name: string; output: string; flagged: string[] };
type RunResult = { steps: RunStep[]; trace_prompt: string };

export type SandboxProps = {
  mission: any; // the active kind:"build" mission (must carry mission.build)
  trace: any[]; // data.trace — TRACE rubric rows, forwarded to <TraceWidget>
  onComplete: (missionId: string, feedback: any) => void;
};

// Friendly labels + placeholders for the editable knobs we know about. Anything
// not listed still renders with a humanised fallback label — never blocks a param.
const PARAM_HINTS: Record<string, { label: string; placeholder: string }> = {
  topic: { label: "Topic", placeholder: "e.g. winter touring luggage" },
  tone: { label: "Tone", placeholder: "e.g. BikeLuggage — practical, no hype" },
  tone_rule: { label: "Tone rule", placeholder: "e.g. no hype words; every claim must match the record" },
  stop_condition: { label: "Stop condition", placeholder: "e.g. stop when every page in the set passes" },
  bike_intake: { label: "Bike intake", placeholder: "e.g. reg AB12 CDE — or make / model / year" },
  policy_rule: { label: "Policy rule", placeholder: "e.g. 30-day returns; never invent a window" },
};

function humanise(key: string) {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Sandbox({ mission, trace, onComplete }: SandboxProps) {
  const build: BuildBlock | undefined = mission?.build;

  // editable param values
  const [params, setParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runErr, setRunErr] = useState("");

  // validation + reflection + honest feedback
  const [traceReady, setTraceReady] = useState(false);
  const [reflect, setReflect] = useState<"workflow" | "one-prompt" | null>(null);
  const [reflectNote, setReflectNote] = useState("");
  const [fb, setFb] = useState<string | null>(null);
  const [fbText, setFbText] = useState("");

  // seed empty values for each editable key when the mission changes
  useEffect(() => {
    const seed: Record<string, string> = {};
    (build?.editable || []).forEach((k) => (seed[k] = ""));
    setParams(seed);
    setResult(null);
    setRunErr("");
    setTraceReady(false);
    setReflect(null);
    setReflectNote("");
    setFb(null);
    setFbText("");
  }, [mission?.id]);

  if (!build) {
    return (
      <div className="wrap pad">
        <div className="card">
          <p style={{ color: "#AEB6C4", fontSize: 13.5 }}>
            This mission has no build sandbox. (Expected a <span className="mono">build</span> block on{" "}
            <b>{mission?.title || mission?.id}</b>.)
          </p>
        </div>
      </div>
    );
  }

  const allFilled = (build.editable || []).every((k) => (params[k] || "").trim().length > 0);
  const flaggedCount = result ? result.steps.reduce((n, s) => n + (s.flagged?.length || 0), 0) : 0;
  const canFinish = !!result && traceReady && reflect !== null && fb !== null;

  async function run() {
    setRunErr("");
    setResult(null);
    setTraceReady(false);
    // The integrator adds api.sandboxRun (see header). Guard so we never crash if it's absent.
    const runner = (api as any).sandboxRun;
    if (typeof runner !== "function") {
      setRunErr("Sandbox run isn't wired up yet (api.sandboxRun missing). See the comment at the top of Sandbox.tsx.");
      return;
    }
    setRunning(true);
    try {
      const out: RunResult = await runner(build.template, params);
      setResult(out);
    } catch (e: any) {
      setRunErr(e?.message || "The workflow run failed.");
    }
    setRunning(false);
  }

  function finish() {
    // Mirror the Mission view's completion payload so the existing onComplete handler works.
    const stars = (traceReady ? 1 : 0) + (flaggedCount > 0 ? 1 : 0) + (reflect === "one-prompt" ? 1 : 0);
    const note = [reflectNote.trim(), fbText.trim()].filter(Boolean).join(" — ");
    onComplete(mission.id, {
      confidence: fb,
      stars,
      applied: true, // running the sandbox on real knobs is the applied step
      quiz: "build",
      note,
    });
  }

  return (
    <div className="wrap pad">
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="crumbs">
          <span className="eyebrow">Build sandbox · rails on</span>
          <span className="sep">/</span>
          <b>{mission.title}</b>
        </div>
        <h1 style={{ fontSize: "clamp(22px,4vw,30px)", fontWeight: 700, lineHeight: 1.1, marginBottom: 8 }}>
          {mission.title}
        </h1>
        <p style={{ fontSize: 13.5, color: "#AEB6C4", marginBottom: 22 }}>
          {mission.learn?.body ||
            "Assemble, run and validate a small workflow. The wiring is pre-built — you only set the knobs, then judge the output."}
        </p>

        {/* ── Pre-wired steps (read-only) ─────────────────────────────── */}
        <div className="phase">① The workflow — already wired</div>
        <div className="card" style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 12.5, color: "#8B94A4", marginBottom: 12 }}>
            <span className="mono" style={{ color: "#F2600C" }}>
              {build.template}
            </span>{" "}
            · {build.steps.length} steps, run in order. You don't touch the wiring — only the knobs below.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {build.steps.map((s, i) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="scorechip">
                  <span className="mono" style={{ color: "#F4A623" }}>
                    {i + 1}
                  </span>
                  {s}
                </span>
                {i < build.steps.length - 1 && <span style={{ color: "#8B94A4" }}>→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ── Editable knobs ──────────────────────────────────────────── */}
        <div className="phase">② Set the knobs ({build.editable.length})</div>
        <div className="card" style={{ marginBottom: 18 }}>
          {build.editable.map((key) => {
            const hint = PARAM_HINTS[key];
            return (
              <div key={key} style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "Space Grotesk",
                    fontWeight: 600,
                    fontSize: 13,
                    marginBottom: 6,
                  }}
                >
                  {hint?.label || humanise(key)}{" "}
                  <span className="mono" style={{ fontSize: 10.5, color: "#8B94A4" }}>
                    {key}
                  </span>
                </label>
                <input
                  value={params[key] || ""}
                  placeholder={hint?.placeholder || `Set ${humanise(key).toLowerCase()}…`}
                  onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                  style={{
                    width: "100%",
                    background: "#14161C",
                    border: "1px solid #323847",
                    borderRadius: 9,
                    padding: "11px 13px",
                    color: "#F3F4F7",
                    fontFamily: "Inter",
                    fontSize: 13.5,
                  }}
                />
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
            <button className="btn" disabled={!allFilled || running} onClick={run}>
              {running ? "Running the workflow…" : "▶ Run workflow"}
            </button>
            {!allFilled && (
              <span style={{ fontSize: 12, color: "#8B94A4" }}>Set every knob to run.</span>
            )}
            <span style={{ fontSize: 11.5, color: "#8B94A4" }}>Read-only — nothing is written anywhere.</span>
          </div>
          {runErr && (
            <p style={{ color: "#D8503A", fontSize: 13, marginTop: 12 }}>{runErr}</p>
          )}
        </div>

        {/* ── Step outputs ────────────────────────────────────────────── */}
        {result && (
          <>
            <div className="phase">③ What each step did</div>
            {flaggedCount > 0 && (
              <div
                style={{
                  background: "rgba(244,166,35,.08)",
                  border: "1px solid rgba(244,166,35,.35)",
                  borderRadius: 9,
                  padding: "10px 13px",
                  marginBottom: 12,
                  fontSize: 12.5,
                  color: "#F4A623",
                }}
              >
                ⚠ The guardrails flagged {flaggedCount} item{flaggedCount === 1 ? "" : "s"} — the workflow caught
                them before they reached you. That's the check earning its place.
              </div>
            )}
            {result.steps.map((s, i) => (
              <div className="stepcard" key={s.name + i} style={{ marginBottom: 11 }}>
                <div className="sn">
                  Step {i + 1} · {s.name}
                </div>
                <p style={{ fontSize: 13, color: "#D7DCE4", whiteSpace: "pre-wrap" }}>{s.output}</p>
                {s.flagged && s.flagged.length > 0 && (
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {s.flagged.map((f, fi) => (
                      <div
                        key={fi}
                        style={{
                          fontSize: 12,
                          color: "#F4A623",
                          background: "rgba(244,166,35,.07)",
                          border: "1px solid rgba(244,166,35,.3)",
                          borderRadius: 7,
                          padding: "7px 11px",
                        }}
                      >
                        ⚑ Flagged: {f}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* ── Validate with TRACE (fed by trace_prompt) ─────────────── */}
            <div className="phase" style={{ marginTop: 24 }}>
              ④ Validate — score it with TRACE
            </div>
            <div className="promptbox" style={{ marginBottom: 14 }}>
              <span className="lbl">▸ What to score against</span>
              <button
                className="cp"
                onClick={() => navigator.clipboard?.writeText(result.trace_prompt)}
              >
                Copy
              </button>
              {result.trace_prompt}
            </div>
            <TraceWidget
              trace={trace}
              onScored={(score: any) =>
                // TraceWidget reports a score; treat a truthy `ready` flag (or any truthy score)
                // as "fit to act". Defensive across whatever shape the widget settles on.
                setTraceReady(score == null ? false : score.ready !== undefined ? !!score.ready : !!score)
              }
            />

            {/* ── "Would one prompt have been faster?" reflection (§F.5) ── */}
            <div className="phase" style={{ marginTop: 24 }}>
              ⑤ Would one prompt have been faster?
            </div>
            <div className="apply">
              <div className="at">🤔 Judgment, not just mechanics</div>
              <p className="aq">
                You don't muster the whole farm to fetch one egg. Was this job worth a workflow — repeated, or split
                into parts that run together — or would a single prompt have done it faster?
              </p>
              <div style={{ display: "flex", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
                {(
                  [
                    ["workflow", "🚜 Worth the workflow"],
                    ["one-prompt", "✋ One prompt would've been faster"],
                  ] as const
                ).map(([v, lab]) => (
                  <button
                    key={v}
                    className="btn ghost sm"
                    style={reflect === v ? { borderColor: "#F2600C", color: "#F2600C" } : {}}
                    onClick={() => setReflect(v)}
                  >
                    {lab}
                  </button>
                ))}
              </div>
              <textarea
                placeholder="One line: why? (what made it worth a workflow, or why a single prompt wins here)"
                value={reflectNote}
                onChange={(e) => setReflectNote(e.target.value)}
              />
            </div>
          </>
        )}

        {/* ── Honest confidence + complete (mirrors Mission view) ─────── */}
        {canFinish ? (
          <div className="feedback">
            <h4>🏁 Before you go — be honest</h4>
            <p className="fp">Could you assemble and validate a workflow like this tomorrow, without this app open?</p>
            <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
              {(
                [
                  ["yes", "💪 Yes"],
                  ["nearly", "🤔 Nearly"],
                  ["no", "😅 Not yet"],
                ] as const
              ).map(([v, lab]) => (
                <button
                  key={v}
                  className="btn ghost sm"
                  style={fb === v ? { borderColor: "#F2600C", color: "#F2600C" } : {}}
                  onClick={() => setFb(v)}
                >
                  {lab}
                </button>
              ))}
            </div>
            <textarea
              placeholder="Anything that clicked or confused you? (optional)"
              value={fbText}
              onChange={(e) => setFbText(e.target.value)}
              style={{
                width: "100%",
                background: "#14161C",
                border: "1px solid #323847",
                borderRadius: 9,
                padding: 11,
                color: "#F3F4F7",
                minHeight: 56,
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 13 }}>
              <button className="btn" disabled={fb === null} onClick={finish}>
                ✓ Complete build mission
              </button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: "#8B94A4", textAlign: "center", marginTop: 18 }}>
            {!result
              ? "Run the workflow above to see what each step did."
              : "Score it with TRACE and answer the reflection to complete this mission."}
          </p>
        )}
      </div>
    </div>
  );
}
