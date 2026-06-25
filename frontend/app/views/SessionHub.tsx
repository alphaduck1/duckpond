"use client";
/**
 * SessionHub — Weeks 1–4 hub (plan 3.1, spec §8.3).
 *
 * IMPORT PATH (for the integrator):
 *   import SessionHub from "@/app/views/SessionHub";
 *
 * EXACT PROPS:
 *   {
 *     sessions:  Record<string, SessionInfo>;   // data.sessions — keys "1".."4"
 *     missions:  Record<string, Mission[]>;      // data.missions — keyed by persona
 *     completed: string[];                       // mission ids the learner has completed
 *     persona:   string;                         // current persona id (abbie/emyr/immy/callum/yas)
 *     onOpen:    (missionId: string) => void;    // open a mission in the existing Mission view
 *     onJourney: () => void;                      // navigate to the My Journey view (plan 3.2)
 *     isAdmin:   boolean;                          // show the team-dashboard button
 *     onDash:    () => void;                       // navigate to the admin dashboard
 *   }
 *
 * NEW API CALLS EXPECTED FROM THE INTEGRATOR: none.
 *   This view is pure presentation over data already loaded via the existing
 *   api.missions() + api.progress() calls in page.tsx. It introduces no new
 *   backend calls. (The Journey/Sandbox/Dashboard views own their own data.)
 *
 * BEHAVIOUR:
 *   - Renders one card per session (Weeks 1–4), in numeric order of the keys.
 *   - Within a week, lists THIS persona's missions (filtered by m.session === week).
 *   - Per-session unlock: a mission unlocks only when every earlier mission in the
 *     SAME session is complete. The first incomplete mission of a session is the
 *     active one; later ones stay locked. (Mirrors the v1 flat-index unlock, but
 *     scoped per session.)
 *   - Reuses existing CSS: wrap, pad, secthead, eyebrow, btn/ghost/sm, missions,
 *     mission, locked, m-head, m-no, m-meta, m-right, mono.
 *
 * This replaces the old flat Map. It does NOT modify page.tsx — the integrator
 * wires it in (add a `view: "sessions"` branch).
 */
import { useMemo } from "react";

type SessionInfo = {
  week: number;
  title: string;
  goal: string;
  concepts: string[];
};

type Mission = {
  id: string;
  session: number;
  tier?: string;
  kind?: string;
  phase: string;
  colour: string;
  title: string;
  real: string;
};

type Props = {
  sessions: Record<string, SessionInfo>;
  missions: Record<string, Mission[]>;
  completed: string[];
  persona: string;
  onOpen: (missionId: string) => void;
  onJourney: () => void;
  onPresent: (sessionId: string) => void;   // open the live presenter deck for a session
  isAdmin: boolean;
  onDash: () => void;
};

const clip = (s: string, n = 96) => (s && s.length > n ? s.slice(0, n) + "…" : s);

export default function SessionHub({
  sessions,
  missions,
  completed,
  persona,
  onOpen,
  onJourney,
  onPresent,
  isAdmin,
  onDash,
}: Props) {
  const done = useMemo(() => new Set(completed), [completed]);
  const list: Mission[] = missions[persona] || [];

  // Ordered session ids ("1".."4"), sorted by week then numeric key.
  const sessionIds = useMemo(
    () =>
      Object.keys(sessions).sort(
        (a, b) => (sessions[a].week - sessions[b].week) || Number(a) - Number(b),
      ),
    [sessions],
  );

  // Overall progress for the eyebrow line.
  const totalDone = list.filter((m) => done.has(m.id)).length;

  return (
    <div className="wrap pad">
      <div className="secthead">
        <div>
          <div className="eyebrow">Your course · 4 weeks</div>
          <h2>Work through the pond, one week at a time</h2>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={onJourney}>
            🧭 My journey
          </button>
          {isAdmin && (
            <button className="btn ghost sm" onClick={onDash}>
              📊 Team dashboard
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--mute)", margin: "-8px 0 24px" }}>
        {totalDone}/{list.length} missions done. Each week unlocks its missions in
        order — finish one to open the next.
      </p>

      <div style={{ display: "grid", gap: 22 }}>
        {sessionIds.map((sid) => {
          const s = sessions[sid];
          const weekNo = Number(sid);
          // This persona's missions for this week, in their authored order.
          const weekMissions = list.filter((m) => m.session === weekNo);

          // Per-session sequential unlock: the next unlockable index is the count
          // of completed missions counting from the top of THIS week's list.
          let nextIdx = 0;
          for (const m of weekMissions) {
            if (done.has(m.id)) nextIdx += 1;
            else break;
          }
          const weekDone = weekMissions.filter((m) => done.has(m.id)).length;
          const weekComplete =
            weekMissions.length > 0 && weekDone === weekMissions.length;

          return (
            <section key={sid} id={"session-" + sid} className="card" style={{ padding: 0, overflow: "hidden", scrollMarginTop: 76 }}>
              {/* Week header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 16,
                  padding: "20px 22px",
                  borderBottom: "1px solid var(--line)",
                  background:
                    "linear-gradient(135deg, rgba(242,96,12,.06), rgba(244,166,35,.03))",
                }}
              >
                <div
                  className="m-no"
                  style={{
                    color: "var(--orange)",
                    borderColor: "var(--line2)",
                    background: "var(--bg2)",
                  }}
                >
                  {weekComplete ? "✓" : s.week}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "var(--mute)",
                      fontFamily: "Space Grotesk",
                      fontWeight: 600,
                    }}
                  >
                    Week {s.week}
                  </div>
                  <h3
                    style={{
                      fontSize: 18.5,
                      fontWeight: 600,
                      marginTop: 3,
                      fontFamily: "Space Grotesk",
                    }}
                  >
                    {s.title}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--mute2)", marginTop: 5 }}>
                    {s.goal}
                  </p>
                  {s.concepts?.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 7,
                        flexWrap: "wrap",
                        marginTop: 11,
                      }}
                    >
                      {s.concepts.map((c, ci) => (
                        <span
                          key={ci}
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            color: "var(--mute)",
                            border: "1px solid var(--line2)",
                            borderRadius: 99,
                            padding: "3px 9px",
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      fontFamily: "Space Grotesk",
                      color: weekComplete ? "var(--green)" : "var(--mute)",
                    }}
                  >
                    {weekDone}/{weekMissions.length}
                  </div>
                  <button
                    className="btn ghost sm"
                    style={{ whiteSpace: "nowrap" }}
                    onClick={() => onPresent(sid)}
                    title="Present this session live to the team"
                  >
                    ▶ Present this session
                  </button>
                </div>
              </div>

              {/* Week missions */}
              <div className="missions" style={{ gap: 0 }}>
                {weekMissions.length === 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--mute)",
                      padding: "16px 22px",
                    }}
                  >
                    No missions for your track this week.
                  </p>
                ) : (
                  weekMissions.map((m, i) => {
                    const isDone = done.has(m.id);
                    const locked = i > nextIdx;
                    const isBuild = m.kind === "build";
                    return (
                      <div
                        key={m.id}
                        className={"mission" + (locked ? " locked" : "")}
                        style={{
                          borderRadius: 0,
                          borderLeft: "none",
                          borderRight: "none",
                          borderTop: "none",
                          background: "transparent",
                          backdropFilter: "none",
                        }}
                      >
                        <div
                          className="m-head"
                          onClick={() => !locked && onOpen(m.id)}
                          style={{ cursor: locked ? "default" : "pointer" }}
                        >
                          <div
                            className="m-no"
                            style={{ color: m.colour, borderColor: m.colour }}
                          >
                            {isDone ? "✓" : i + 1}
                          </div>
                          <div className="m-meta">
                            <div className="k">
                              {m.phase}
                              {isBuild && " · 🛠 Build"}
                            </div>
                            <h3>{m.title}</h3>
                            <div className="real">📌 {clip(m.real)}</div>
                          </div>
                          <div className="m-right">
                            {locked ? (
                              <span
                                className="mono"
                                style={{ fontSize: 11, color: "var(--mute)" }}
                              >
                                🔒
                              </span>
                            ) : (
                              <span style={{ color: m.colour }}>
                                {isDone ? "Revisit" : "Start ▸"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
