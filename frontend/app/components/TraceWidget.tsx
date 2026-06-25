"use client";
// ────────────────────────────────────────────────────────────────────────────
// TraceWidget — interactive TRACE scorer (plan 3.3)
//
// Import path:   import TraceWidget from "@/app/components/TraceWidget";
//                (from page.tsx in app/, the relative "./components/TraceWidget"
//                 also resolves)
//
// Props:         {
//                  trace: TraceRow[]          // the data.trace array:
//                                             // [[k, name, desc, colour], ...]
//                                             // (5 rows: T R A C E)
//                  onScored?: (score: number) => void  // optional; called with
//                                             // the count of letters marked PASS
//                                             // (0..5) whenever the marks change
//                }
//
// New api call expected from the integrator: NONE. This component is purely
// client-side and presentational; it reads the `trace` prop (already on
// data.trace) and reports its score via the optional onScored callback. The
// integrator wires <TraceWidget trace={trace} onScored={setTraceScore} /> into
// the Mission view in page.tsx (replacing the static traceboard block) and may
// gate completion on `score === 5`.
//
// Reuses existing globals.css classes: traceboard, trow, trow.on, tk, tt, card.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";

type TraceRow = [string, string, string, string]; // [key, name, desc, colour]
type Mark = "pass" | "fail" | undefined;

export default function TraceWidget({
  trace,
  onScored,
}: {
  trace: TraceRow[];
  onScored?: (score: number) => void;
}) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});

  const passCount = useMemo(
    () => trace.filter(([k]) => marks[k] === "pass").length,
    [trace, marks],
  );
  const allMarked = useMemo(
    () => trace.every(([k]) => marks[k] !== undefined),
    [trace, marks],
  );
  const firstFail = useMemo(
    () => trace.find(([k]) => marks[k] === "fail"),
    [trace, marks],
  );

  // Report the current pass-count to the parent whenever it changes.
  useEffect(() => {
    onScored?.(passCount);
  }, [passCount, onScored]);

  function mark(k: string, value: "pass" | "fail") {
    setMarks((m) => ({ ...m, [k]: m[k] === value ? undefined : value }));
  }

  // Verdict: all 5 pass → ready; any fail → not yet (name the gap);
  // otherwise prompt to finish scoring.
  let verdict: { tone: "ready" | "stop" | "wait"; head: string; body: string };
  if (allMarked && passCount === 5) {
    verdict = {
      tone: "ready",
      head: "✓ Fit to act",
      body: "All five checks pass — this output is safe to send, publish, or act on.",
    };
  } else if (firstFail) {
    verdict = {
      tone: "stop",
      head: "✕ Not yet — close the gap first",
      body: `“${firstFail[1]}” failed: ${firstFail[2]} Fix that before you act on this.`,
    };
  } else {
    verdict = {
      tone: "wait",
      head: "Mark each letter pass or fail",
      body: "Score all five before you decide whether it's fit to act.",
    };
  }

  const toneColour =
    verdict.tone === "ready"
      ? "var(--green)"
      : verdict.tone === "stop"
        ? "var(--red)"
        : "var(--mute)";

  return (
    <div>
      <div className="traceboard">
        {trace.map(([k, name, desc, col]) => {
          const m = marks[k];
          const dim = m === "fail" ? 0.5 : 1;
          return (
            <div
              key={k}
              className={"trow" + (m === "pass" ? " on" : "")}
              style={
                m === "fail"
                  ? {
                      borderColor: "rgba(216,80,58,.4)",
                      background: "rgba(216,80,58,.06)",
                    }
                  : undefined
              }
            >
              <div className="tk" style={{ background: col, opacity: dim }}>
                {k}
              </div>
              <div className="tt">
                <h5>{name}</h5>
                <span>{desc}</span>
              </div>
              <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                <button
                  onClick={() => mark(k, "pass")}
                  aria-pressed={m === "pass"}
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 600,
                    fontSize: 11.5,
                    padding: "6px 11px",
                    borderRadius: 99,
                    border:
                      "1px solid " +
                      (m === "pass" ? "var(--green)" : "var(--line2)"),
                    background:
                      m === "pass" ? "rgba(51,176,106,.15)" : "transparent",
                    color: m === "pass" ? "var(--green)" : "var(--mute)",
                    transition: ".15s",
                  }}
                >
                  ✓ Pass
                </button>
                <button
                  onClick={() => mark(k, "fail")}
                  aria-pressed={m === "fail"}
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 600,
                    fontSize: 11.5,
                    padding: "6px 11px",
                    borderRadius: 99,
                    border:
                      "1px solid " +
                      (m === "fail" ? "var(--red)" : "var(--line2)"),
                    background:
                      m === "fail" ? "rgba(216,80,58,.15)" : "transparent",
                    color: m === "fail" ? "var(--red)" : "var(--mute)",
                    transition: ".15s",
                  }}
                >
                  ✕ Fail
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="card"
        style={{
          marginTop: 12,
          borderColor: toneColour,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 13,
            color: toneColour,
            flexShrink: 0,
          }}
        >
          {passCount}/5
        </div>
        <div>
          <div
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 600,
              fontSize: 14,
              color: toneColour,
              marginBottom: 3,
            }}
          >
            {verdict.head}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--mute2)" }}>{verdict.body}</p>
        </div>
      </div>
    </div>
  );
}
