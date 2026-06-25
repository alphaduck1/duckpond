"use client";
/**
 * Journey.tsx — "My Journey" view (plan 3.2).
 *
 * IMPORT PATH (for the integrator):
 *   import Journey from "@/app/views/Journey";
 *
 * EXACT PROPS:
 *   <Journey
 *     sessions={data.sessions}              // Record<string, Session>  keys "1".."4"
 *     missions={data.missions[persona]}     // Mission[]  (the current persona's list only)
 *     completed={completed}                 // string[]   completed mission ids
 *     persona={persona}                     // string     current persona key
 *     feedbackByMission={feedbackByMission} // Record<missionId, JourneyFeedback>  the LEARNER's own per-mission feedback
 *   />
 *
 * NEW API CALL EXPECTED FROM THE INTEGRATOR:
 *   None strictly required — this view is pure-presentational over data already loaded
 *   (api.missions() gives `sessions` + `missions`; api.progress(persona) gives `completed`).
 *   `feedbackByMission` is the one new piece of data: a map of the signed-in learner's own
 *   completion feedback keyed by mission id, shape { confidence?: "yes"|"nearly"|"no"; stars?: number }.
 *   The integrator should populate it from progress/feedback already stored per user. If it is
 *   not yet wired, pass {} and the view degrades gracefully (progress + toolkit still render;
 *   the confidence trend simply shows "no completions logged yet").
 */
import { useMemo, useState } from "react";

// ---- Types ----
export type Session = {
  week: number;
  title: string;
  goal: string;
  concepts: string[];
};

export type Mission = {
  id: string;
  session: number;
  title: string;
  colour?: string;
  keep?: { label: string; desc: string; text: string } | null;
};

export type JourneyFeedback = {
  confidence?: "yes" | "nearly" | "no";
  stars?: number;
};

export type JourneyProps = {
  sessions: Record<string, Session>;
  missions: Mission[];
  completed: string[];
  persona: string;
  feedbackByMission: Record<string, JourneyFeedback>;
};

const CONF: Record<string, { emoji: string; label: string; colour: string }> = {
  yes: { emoji: "💪", label: "Confident", colour: "#33B06A" },
  nearly: { emoji: "🤔", label: "Nearly", colour: "#F4A623" },
  no: { emoji: "😅", label: "Not yet", colour: "#D8503A" },
};

export default function Journey({
  sessions,
  missions,
  completed,
  persona,
  feedbackByMission,
}: JourneyProps) {
  const done = useMemo(() => new Set(completed), [completed]);

  // Sessions sorted by week, "1".."4".
  const weeks = useMemo(
    () =>
      Object.entries(sessions || {})
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => a.week - b.week),
    [sessions]
  );

  // Group the persona's missions by session id.
  const bySession = useMemo(() => {
    const map: Record<string, Mission[]> = {};
    for (const m of missions || []) {
      const key = String(m.session);
      (map[key] ||= []).push(m);
    }
    return map;
  }, [missions]);

  const totalDone = (missions || []).filter((m) => done.has(m.id)).length;
  const total = (missions || []).length;
  const overallPct = total ? Math.round((totalDone / total) * 100) : 0;

  // Confidence trend, in completion order (the order ids appear in `completed`).
  const trend = useMemo(() => {
    const out: { id: string; title: string; fb: JourneyFeedback }[] = [];
    for (const id of completed || []) {
      const fb = feedbackByMission?.[id];
      if (!fb || !fb.confidence) continue;
      const m = (missions || []).find((x) => x.id === id);
      out.push({ id, title: m?.title || id, fb });
    }
    return out;
  }, [completed, feedbackByMission, missions]);

  // Kept Toolkit = keep artifacts from completed missions.
  const toolkit = useMemo(
    () =>
      (missions || []).filter((m) => done.has(m.id) && m.keep),
    [missions, done]
  );

  return (
    <div className="wrap pad">
      <div className="secthead">
        <div>
          <div className="eyebrow">My journey</div>
          <h2>Your four weeks, {persona} — what you've done and what you keep</h2>
        </div>
        <span className="scorechip">
          <span className="star">{"★".repeat(Math.min(3, Math.ceil(overallPct / 34)))}</span>{" "}
          {totalDone}/{total} missions · {overallPct}%
        </span>
      </div>

      {/* ── Four weeks with progress ───────────────────────────── */}
      <div className="phase">① The four weeks</div>
      <div className="missions" style={{ marginBottom: 30 }}>
        {weeks.map((w) => {
          const list = bySession[w.id] || [];
          const dcount = list.filter((m) => done.has(m.id)).length;
          const pct = list.length ? Math.round((dcount / list.length) * 100) : 0;
          const complete = list.length > 0 && dcount === list.length;
          return (
            <div key={w.id} className="mission">
              <div className="m-head" style={{ cursor: "default", alignItems: "flex-start" }}>
                <div
                  className="m-no"
                  style={{
                    color: complete ? "#33B06A" : "#F2600C",
                    borderColor: complete ? "#33B06A" : "#F2600C",
                  }}
                >
                  {complete ? "✓" : `W${w.week}`}
                </div>
                <div className="m-meta">
                  <div className="k">
                    Week {w.week} · {dcount}/{list.length} done
                  </div>
                  <h3>{w.title}</h3>
                  <div className="real">📌 {w.goal}</div>
                  <div className="rbar" style={{ width: "100%", marginTop: 11 }}>
                    <i style={{ width: pct + "%" }} />
                  </div>
                </div>
                <div className="m-right">
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: complete ? "#33B06A" : "#8B94A4" }}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Confidence trend from the learner's own completions ── */}
      <div className="phase">② Your confidence trend</div>
      <div className="card" style={{ marginBottom: 30 }}>
        <p style={{ fontSize: 12.5, color: "#AEB6C4", marginBottom: 14 }}>
          Each mission you finished, in order, with how confident you said you'd be doing it for
          real tomorrow. Honest "not yet"s are the point — they show what to revisit.
        </p>
        {trend.length === 0 ? (
          <p style={{ fontSize: 13, color: "#8B94A4" }}>
            No completions logged yet — finish a mission and your trend will appear here.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 9 }}>
            {trend.map((t, i) => {
              const c = CONF[t.fb.confidence as string] || {
                emoji: "•",
                label: "",
                colour: "#8B94A4",
              };
              const stars = t.fb.stars || 0;
              return (
                <div
                  key={t.id + i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    background: "#1A1D25",
                    border: "1px solid #323847",
                    borderRadius: 9,
                    padding: "11px 14px",
                  }}
                >
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "#8B94A4", width: 26, flexShrink: 0 }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ fontSize: 20, flexShrink: 0 }}>{c.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "Space Grotesk",
                        fontWeight: 600,
                        fontSize: 13.5,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: c.colour, fontWeight: 600 }}>
                      {c.label}
                      {stars ? (
                        <span style={{ color: "#F4A623" }}>
                          {" · "}
                          {"★".repeat(stars)}
                          {"☆".repeat(Math.max(0, 3 - stars))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Kept Toolkit ────────────────────────────────────────── */}
      <div className="phase">③ Your kept toolkit</div>
      {toolkit.length === 0 ? (
        <div className="card">
          <p style={{ fontSize: 13.5, color: "#AEB6C4" }}>
            Nothing kept yet. Complete missions to collect their reusable prompts and checks here —
            your own toolkit you can copy and reuse on real work.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {toolkit.map((m) => (
            <KeepCard key={m.id} keep={m.keep!} />
          ))}
        </div>
      )}
    </div>
  );
}

function KeepCard({ keep }: { keep: { label: string; desc: string; text: string } }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(keep.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  }
  return (
    <div className="keep">
      <div className="kt">⭐ Your reusable {keep.label}</div>
      <p className="kd">{keep.desc}</p>
      <div className="kbox">
        <button className="cp" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        {keep.text}
      </div>
    </div>
  );
}
