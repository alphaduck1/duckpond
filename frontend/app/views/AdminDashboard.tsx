"use client";
// ─────────────────────────────────────────────────────────────────────────────
// AdminDashboard — Callum's upgraded team-oversight view (plan 3.6).
//
// IMPORT PATH:   import AdminDashboard from "@/app/views/AdminDashboard";
//                (from page.tsx: import AdminDashboard from "./views/AdminDashboard";)
//
// PROPS:         { people: Record<string, Person>, missions: Record<string, Mission[]> }
//                — the same `people` and `missions` objects page.tsx already passes to
//                  the old inline <Dashboard/>. Wire it in where <Dashboard .../> renders.
//
// API CALLS USED (all already exist in lib/api.ts — NO new call required):
//   api.dashboard()        — now returns the richer shape with by_session / heatmap / stuck
//   api.proposals(status)  — self-improvement proposal queue (UNCHANGED)
//   api.runAgents()        — run-agents button (UNCHANGED)
//   api.decideProposal()   — approve / reject / dismiss (UNCHANGED)
//   → Integrator: no additions to lib/api.ts needed for this component. The existing
//     `dashboard()` method already returns the new fields; only its TS return type (if
//     you tighten `any`) would need the extra keys.
//
// This is based on the existing inline Dashboard in page.tsx: the stat row + the
// self-improvement proposal queue + the feedback list are preserved verbatim in
// behaviour, and three sections are ADDED: per-session completion, a persona×mission
// confidence heatmap, and a "who's stuck" list — consuming the new
// /api/dashboard fields (by_session, heatmap, stuck).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// ── Types for the richer /api/dashboard payload (Task 2.2) ────────────────────
type Feedback = {
  user_email: string;
  name: string;
  persona: string;
  mission_id: string;
  confidence: string;
  stars: number;
  applied: boolean;
  quiz: string;
  note: string;
  created_at: string;
};
type SessionCell = { completed: number; low_conf: number };
type HeatCell = { persona: string; mission_id: string; confidence: string; stars: number };
type StuckRow = { name: string; persona: string; mission_id: string; reason: string };

type DashData = {
  progress: { persona: string; count: number }[];
  feedback: Feedback[];
  applied_total: number;
  not_yet_total: number;
  by_session: Record<string, SessionCell>;
  heatmap: HeatCell[];
  stuck: StuckRow[];
};

type Proposal = {
  id: number;
  kind: string;
  source_agent: string;
  title: string;
  rationale: string;
};

type Person = { name: string; role: string; colour: string };

type Props = {
  people: Record<string, Person>;
  missions: Record<string, any[]>;
};

const CONF_LABEL: Record<string, [string, string]> = {
  yes: ["💪", "Confident"],
  nearly: ["🤔", "Nearly"],
  no: ["😅", "Not yet"],
};

// Confidence → colour for the heatmap cells (reuses the palette from globals.css).
const CONF_COLOUR: Record<string, string> = {
  yes: "#33B06A", // green
  nearly: "#F4A623", // amber
  no: "#D8503A", // red
};

export default function AdminDashboard({ people, missions }: Props) {
  const [d, setD] = useState<DashData | null>(null);
  const [err, setErr] = useState("");
  const [props, setProps] = useState<Proposal[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadProps() {
    try {
      setProps(await api.proposals("pending"));
    } catch {}
  }
  useEffect(() => {
    api.dashboard().then(setD).catch((e: any) => setErr(e.message));
    loadProps();
  }, []);

  async function runNow() {
    setRunning(true);
    setMsg("");
    try {
      const r = await api.runAgents();
      setMsg(r.summary || "Done");
      await loadProps();
    } catch (e: any) {
      setMsg(e.message);
    }
    setRunning(false);
  }
  async function decide(id: number, decision: "approved" | "rejected") {
    await api.decideProposal(id, decision);
    setProps((p) => p.filter((x) => x.id !== id));
  }

  if (err) return <div className="wrap pad"><p style={{ color: "#D8503A" }}>{err}</p></div>;
  if (!d) return <div className="wrap pad"><p style={{ color: "#8B94A4" }}>Loading team data…</p></div>;

  // ── helpers ────────────────────────────────────────────────────────────────
  const missionTitle = (persona: string, id: string) =>
    missions[persona]?.find((m) => m.id === id)?.title || id;

  // Session ids: prefer the keys the backend returns, fall back to 1..4, sorted numerically.
  const sessionIds = Object.keys(d.by_session).length
    ? Object.keys(d.by_session).sort((a, b) => Number(a) - Number(b))
    : ["1", "2", "3", "4"];

  // Heatmap rows = personas; columns = the distinct missions seen in the heatmap for
  // that persona (keeps the grid compact — only missions with feedback show up).
  const personaIds = Object.keys(people);
  const heatByPersona: Record<string, HeatCell[]> = {};
  for (const c of d.heatmap) {
    (heatByPersona[c.persona] ||= []).push(c);
  }

  return (
    <div className="wrap pad">
      <div className="secthead">
        <div><div className="eyebrow">Oversight</div><h2>How the team's tracking</h2></div>
      </div>

      {/* ── headline stats (unchanged) ── */}
      <div className="dash-grid">
        <div className="stat"><div className="n">{d.feedback.length}</div><div className="l">Missions completed</div></div>
        <div className="stat"><div className="n" style={{ color: "#33B06A" }}>{d.applied_total}</div><div className="l">Applied to real work</div></div>
        <div className="stat"><div className="n" style={{ color: d.not_yet_total ? "#F4A623" : "#33B06A" }}>{d.not_yet_total}</div><div className="l">"Not yet" confidence</div></div>
      </div>

      {/* ── NEW: per-session completion row ── */}
      <div className="eyebrow" style={{ margin: "26px 0 11px" }}>Progress by session</div>
      <div className="dash-grid">
        {sessionIds.map((sid) => {
          const cell = d.by_session[sid] || { completed: 0, low_conf: 0 };
          return (
            <div key={sid} className="stat">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <div className="n">{cell.completed}</div>
                {cell.low_conf > 0 && (
                  <span className="pill" style={{ background: "rgba(244,166,35,.16)", color: "#F4A623" }}>
                    {cell.low_conf} low conf
                  </span>
                )}
              </div>
              <div className="l">Session {sid} · completed</div>
            </div>
          );
        })}
      </div>

      {/* ── NEW: persona × mission confidence heatmap ── */}
      <div className="eyebrow" style={{ margin: "26px 0 11px" }}>Confidence heatmap — where it's clicking, where it isn't</div>
      <div className="card">
        {d.heatmap.length === 0 ? (
          <p style={{ color: "#AEB6C4", fontSize: 13.5 }}>No confidence data yet — it fills in as the team completes missions.</p>
        ) : (
          <>
            <div style={{ display: "grid", gap: 12 }}>
              {personaIds
                .filter((pid) => (heatByPersona[pid]?.length ?? 0) > 0)
                .map((pid) => {
                  const p = people[pid];
                  return (
                    <div key={pid} style={{ display: "flex", alignItems: "center", gap: 13 }}>
                      <div
                        className="who-av"
                        style={{ background: p?.colour || "#3E4556", flexShrink: 0 }}
                        title={p?.name || pid}
                      >
                        {(p?.name || pid).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {heatByPersona[pid].map((c, i) => {
                          const col = CONF_COLOUR[c.confidence] || "#3E4556";
                          const [emoji, label] = CONF_LABEL[c.confidence] || ["•", c.confidence];
                          return (
                            <div
                              key={c.mission_id + i}
                              title={`${missionTitle(pid, c.mission_id)} · ${label} · ${"★".repeat(c.stars)}`}
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                background: col + "22",
                                border: `1px solid ${col}`,
                                color: col,
                                display: "grid",
                                placeItems: "center",
                                fontSize: 14,
                                cursor: "default",
                              }}
                            >
                              {emoji}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
              {(["yes", "nearly", "no"] as const).map((k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8B94A4" }}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: CONF_COLOUR[k], display: "inline-block" }} />
                  {CONF_LABEL[k][1]}
                </span>
              ))}
              <span style={{ fontSize: 11.5, color: "#8B94A4" }}>· one cell per completed mission · hover for detail</span>
            </div>
          </>
        )}
      </div>

      {/* ── NEW: who's stuck ── */}
      <div className="eyebrow" style={{ margin: "26px 0 11px" }}>Who's stuck — worth a quiet check-in</div>
      <div className="card">
        {d.stuck.length === 0 ? (
          <p style={{ color: "#AEB6C4", fontSize: 13.5 }}>Nobody's flagged as stuck right now. 🎉</p>
        ) : (
          d.stuck.map((s, i) => {
            const p = people[s.persona];
            const reasonNice =
              s.reason === "confidence=no"
                ? "Said “not yet” on this task"
                : s.reason === "repeated low stars"
                ? "Repeated low scores"
                : s.reason;
            return (
              <div
                key={s.persona + s.mission_id + i}
                style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 0", borderBottom: i < d.stuck.length - 1 ? "1px solid #323847" : "none" }}
              >
                <div className="who-av" style={{ background: p?.colour || "#D8503A", flexShrink: 0 }}>
                  {(s.name || s.persona).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontFamily: "Space Grotesk", fontSize: 13.5 }}>
                    {s.name} <span style={{ color: "#8B94A4", fontWeight: 400 }}>· {missionTitle(s.persona, s.mission_id)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#8B94A4" }}>{reasonNice}</div>
                </div>
                <span className="pill" style={{ background: "rgba(216,80,58,.14)", color: "#D8503A", flexShrink: 0 }}>needs a hand</span>
              </div>
            );
          })
        )}
      </div>

      {/* ── Self-improvement engine (UNCHANGED from the original Dashboard) ── */}
      <div className="secthead" style={{ marginTop: 30 }}>
        <div><div className="eyebrow">Self-improvement engine</div><h2 style={{ fontSize: 20 }}>🤖 Proposals to review</h2></div>
        <button className="btn sm" disabled={running} onClick={runNow}>{running ? "Running agents…" : "▶ Run agents now"}</button>
      </div>
      {msg && <p style={{ fontSize: 13, color: "#AEB6C4", marginBottom: 10 }}>{msg}</p>}
      <p style={{ fontSize: 12.5, color: "#8B94A4", marginBottom: 12 }}>
        Agents draft these automatically from the team's feedback + market research. Nothing goes live until you approve it — capability is not authorisation.
      </p>
      {props.length === 0 ? (
        <div className="card"><p style={{ color: "#AEB6C4", fontSize: 13.5 }}>No pending proposals. Run the agents, or wait for tonight's automatic run.</p></div>
      ) : (
        props.map((p) => (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <span className="pill" style={{ background: p.kind === "new_mission" ? "#33B06A" : p.kind === "insight" ? "#4C8DE8" : "#F2600C", color: "#fff", fontSize: 10 }}>{p.source_agent}</span>
                <h4 style={{ fontFamily: "Space Grotesk", fontSize: 15, margin: "8px 0 4px" }}>{p.title}</h4>
                <p style={{ fontSize: 12.5, color: "#AEB6C4" }}>{p.rationale}</p>
              </div>
              {p.kind !== "insight" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button className="btn sm" onClick={() => decide(p.id, "approved")}>✓ Approve</button>
                  <button className="btn ghost sm" onClick={() => decide(p.id, "rejected")}>Reject</button>
                </div>
              )}
              {p.kind === "insight" && <button className="btn ghost sm" onClick={() => decide(p.id, "rejected")}>Dismiss</button>}
            </div>
          </div>
        ))
      )}

      {/* ── feedback list (UNCHANGED) ── */}
      <div className="eyebrow" style={{ margin: "26px 0 11px" }}>What the feedback is telling us</div>
      <div className="card">
        {d.feedback.length === 0 ? <p style={{ color: "#AEB6C4" }}>No feedback yet.</p> :
          d.feedback.slice().reverse().slice(0, 12).map((f, i) => {
            const mm = missions[f.persona]?.find((x) => x.id === f.mission_id);
            const conf = CONF_LABEL[f.confidence] || ["•", ""];
            return <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #323847" }}>
              <div style={{ fontSize: 20 }}>{conf[0]}</div>
              <div><div style={{ fontWeight: 600, fontFamily: "Space Grotesk", fontSize: 13.5 }}>{f.name} · {mm ? mm.title : f.mission_id}
                <span style={{ color: "#8B94A4", fontWeight: 400 }}> · {conf[1]} · {"★".repeat(f.stars)}{f.applied ? " · ✓ applied" : ""}</span></div>
                <div style={{ fontSize: 12.5, color: "#8B94A4" }}>{f.note ? "“" + f.note + "”" : "No note"}</div></div>
            </div>;
          })}
      </div>
    </div>
  );
}
