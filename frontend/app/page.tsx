"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import { speak, stopSpeak } from "@/lib/voice";
import SessionHub from "@/app/views/SessionHub";
import Journey from "@/app/views/Journey";
import Sandbox from "@/app/views/Sandbox";
import AdminDashboard from "@/app/views/AdminDashboard";
import TraceWidget from "@/app/components/TraceWidget";
import { GlossaryProvider } from "@/app/components/Glossary";

declare global { interface Window { google?: any; } }

const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// Sandbox templates that the backend actually serves. A kind:"build" mission only
// opens the interactive Sandbox if its build.template is one of these; the other
// build missions (self-improvement-engine, agents-py) fall back to the standard
// Mission walkthrough.
const SANDBOX_TEMPLATES = new Set(["content-batch", "page-loop", "fitment-verify"]);

// The learner's own per-mission feedback isn't returned by /api/progress, so we
// remember it locally (keyed by persona) for the My Journey confidence trend.
function fbKey(persona: string) { return `duckpond.fb.${persona}`; }
function loadLocalFeedback(persona: string): Record<string, { confidence?: string; stars?: number }> {
  try { return JSON.parse(localStorage.getItem(fbKey(persona)) || "{}"); } catch { return {}; }
}
function saveLocalFeedback(persona: string, mid: string, fb: { confidence?: string; stars?: number }) {
  try {
    const all = loadLocalFeedback(persona);
    all[mid] = { confidence: fb.confidence, stars: fb.stars };
    localStorage.setItem(fbKey(persona), JSON.stringify(all));
  } catch {}
}

type View = "pick" | "sessions" | "journey" | "mission" | "dash";

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null); // {sessions,people,trace,glossary,missions}
  const [view, setView] = useState<View>("pick");
  const [persona, setPersona] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [feedbackByMission, setFeedbackByMission] = useState<Record<string, { confidence?: string; stars?: number }>>({});
  const [activeMid, setActiveMid] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [err, setErr] = useState("");

  // restore session
  useEffect(() => {
    (async () => {
      try {
        const m = await api.me();
        setUser(m);
        if (m.persona) setPersona(m.persona);
      } catch {}
      try { setData(await api.missions()); } catch {}
      try { setReadAloud(localStorage.getItem("duckpond.read") === "on"); } catch {}
      setLoading(false);
    })();
  }, []);

  // load progress when persona chosen
  useEffect(() => {
    if (user && persona) {
      api.progress(persona).then((p) => setCompleted(p.completed)).catch(() => {});
      setFeedbackByMission(loadLocalFeedback(persona));
      setView("sessions");
    }
  }, [user, persona]);

  if (loading) return <Splash />;
  if (!user) return <Login onUser={setUser} clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""} setErr={setErr} err={err} />;
  if (!data) return <Splash msg="Loading the pond…" />;

  const people = data.people, missions = data.missions, trace = data.trace,
    sessions = data.sessions, glossary = data.glossary;

  const activeMission = persona && activeMid
    ? missions[persona].find((x: any) => x.id === activeMid)
    : null;
  const isSandboxMission =
    activeMission?.kind === "build" &&
    SANDBOX_TEMPLATES.has(activeMission?.build?.template);

  async function pickPersona(id: string) {
    setPersona(id);
    try { await api.setPersona(id); } catch {}
  }
  function toggleRead() {
    setReadAloud((s) => { const n = !s; try { localStorage.setItem("duckpond.read", n ? "on" : "off"); } catch {} if (!n) stopSpeak(); return n; });
  }
  async function onComplete(mid: string, fb: any) {
    if (persona) saveLocalFeedback(persona, mid, fb);
    try {
      await api.complete({ persona, mission_id: mid, ...fb });
      const p = await api.progress(persona!);
      setCompleted(p.completed);
      if (persona) setFeedbackByMission(loadLocalFeedback(persona));
    } catch (e: any) { setErr(e.message); }
    setView("sessions");
  }

  return (
    <GlossaryProvider glossary={glossary}>
      <Header user={user} persona={persona} readAloud={readAloud} toggleRead={toggleRead}
        onSwitch={() => { setPersona(null); setView("pick"); }}
        completed={completed} total={persona ? missions[persona].length : 0} />
      <main>
        {view === "pick" && <Pick people={people} onPick={pickPersona} />}
        {view === "sessions" && persona && (
          <SessionHub sessions={sessions} missions={missions} completed={completed} persona={persona}
            isAdmin={user.is_admin}
            onOpen={(mid: string) => { setActiveMid(mid); setView("mission"); }}
            onJourney={() => setView("journey")}
            onDash={() => setView("dash")} />
        )}
        {view === "journey" && persona && (
          <Journey sessions={sessions} missions={missions[persona]} completed={completed}
            persona={persona} feedbackByMission={feedbackByMission as any} />
        )}
        {view === "mission" && persona && activeMission && (
          isSandboxMission ? (
            <Sandbox mission={activeMission} trace={trace} onComplete={onComplete} />
          ) : (
            <Mission m={activeMission} trace={trace} readAloud={readAloud}
              onBack={() => setView("sessions")} onComplete={onComplete} />
          )
        )}
        {view === "dash" && <AdminDashboard people={people} missions={missions} />}
      </main>
      <footer className="foot"><div className="wrap">The Duck Pond 🦆 · grounded in your real tasks · built on Claude · your data is saved centrally</div></footer>
    </GlossaryProvider>
  );
}

function Splash({ msg = "The Duck Pond" }: { msg?: string }) {
  return <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "Space Grotesk", color: "#F3F4F7" }}>
    <div style={{ textAlign: "center" }}><div style={{ fontSize: 40 }}>🦆</div><p style={{ color: "#8B94A4", marginTop: 8 }}>{msg}</p></div>
  </div>;
}

function Login({ onUser, clientId, setErr, err }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (window.google && ref.current) {
        clearInterval(t);
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: any) => {
            try { const u = await api.login(resp.credential); onUser(u); }
            catch (e: any) { setErr(e.message); }
          },
        });
        window.google.accounts.id.renderButton(ref.current, { theme: "filled_black", size: "large", shape: "pill" });
      }
    }, 200);
    return () => clearInterval(t);
  }, [clientId]);
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", position: "relative", zIndex: 2 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: "center", padding: 36 }}>
        <div style={{ fontSize: 44 }}>🦆</div>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: 26, margin: "10px 0 6px" }}>The Duck Pond</h1>
        <p style={{ color: "#AEB6C4", fontSize: 14, marginBottom: 22 }}>
          Agentic AI training, grounded in your real work. Sign in with your company Google account.
        </p>
        <div ref={ref} style={{ display: "grid", placeItems: "center" }} />
        {err && <p style={{ color: "#D8503A", fontSize: 13, marginTop: 14 }}>{err}</p>}
      </div>
    </div>
  );
}

function Header({ user, persona, readAloud, toggleRead, onSwitch, completed, total }: any) {
  const pct = total ? Math.round((completed.length / total) * 100) : 30;
  return (
    <header className="top">
      <div className="wrap top-in">
        <div className="brand"><span className="dot" /><div>The Duck Pond<small>Agentic AI · Bikeluggage & Motoplanet</small></div></div>
        <div className="top-sp" />
        <button className={"sndbtn" + (readAloud ? " on" : "")} onClick={toggleRead}>{readAloud ? "🗣️ Read aloud on" : "🔇 Read aloud off"}</button>
        <div className="who">
          {user.picture ? <img src={user.picture} alt="" style={{ width: 30, height: 30, borderRadius: "50%" }} /> : <div className="who-av" style={{ background: "#F2600C" }}>{initials(user.name || user.email)}</div>}
          <div>{persona ? <>You're <b>{persona}</b></> : <b>{user.name || user.email}</b>}</div>
          {persona && <button className="switch" onClick={onSwitch}>Switch</button>}
          <button className="switch" onClick={() => { api.logout(); location.reload(); }}>Sign out</button>
        </div>
      </div>
      <div className="rail"><i style={{ width: pct + "%" }} /></div>
    </header>
  );
}

function Pick({ people, onPick }: any) {
  return (
    <div className="hero"><div className="hero-grid" /><div className="wrap hero-in">
      <div className="tagrow"><span className="t">LEARN BY DOING</span><span className="t">YOUR REAL TASKS</span><span className="t">NOT READING</span></div>
      <h1>Learn agentic AI by doing <span className="hl">your actual job</span>.</h1>
      <p className="lead">Every mission is a real task from your Notion. Do it for real in Claude and Codex, build reusable Skills, and learn to tell good output from confident-but-wrong. Your progress is saved centrally.</p>
      <div style={{ marginTop: 30 }}>
        <div className="eyebrow" style={{ marginBottom: 13 }}>Who are you?</div>
        <div className="people">
          {Object.entries(people).map(([id, p]: any) => (
            <button key={id} className="person" onClick={() => onPick(id)}>
              <div className="av" style={{ background: p.colour }}>{initials(p.name)}</div>
              <h3>{p.name}</h3><div className="role">{p.role}</div>
            </button>
          ))}
        </div>
      </div>
    </div></div>
  );
}

function Mission({ m, trace, readAloud, onBack, onComplete }: any) {
  const [traceScore, setTraceScore] = useState(0);
  const [spotPick, setSpotPick] = useState<string | null>(null);
  const [qi, setQi] = useState<any>({});
  const [applyText, setApplyText] = useState("");
  const [applySkipped, setApplySkipped] = useState(false);
  const [fb, setFb] = useState<string | null>(null);
  const [fbText, setFbText] = useState("");
  const [speaking, setSpeaking] = useState(false);

  const readScript = `Your real task. ${m.real}. Here's the idea: ${m.learn.concept}. ${m.learn.body}. To do it: ${m.steps.map((s: any) => s.h + ". " + s.p).join(" ")}`;
  function listen() { setSpeaking(true); speak(readScript, () => setSpeaking(false)); }
  function hush() { stopSpeak(); setSpeaking(false); }
  useEffect(() => { if (readAloud) { const id = setTimeout(listen, 350); return () => { clearTimeout(id); stopSpeak(); }; } return () => stopSpeak(); }, [m.id, readAloud]);

  const quizDone = m.quiz.every((_: any, i: number) => qi[i] !== undefined);
  const quizScore = m.quiz.reduce((s: number, q: any, i: number) => s + (qi[i] === q.a ? 1 : 0), 0);
  const spotDone = spotPick !== null;
  const spotCorrect = spotDone && m.spot[spotPick!]?.correct;
  const traceReady = traceScore === 5;
  const applyMet = !m.apply || applyText.trim().length >= 25 || applySkipped;
  const canFinish = quizDone && spotDone && traceReady && applyMet;
  const stars = (spotCorrect ? 1 : 0) + (quizScore === m.quiz.length ? 1 : 0) + (m.apply && applyText.trim().length >= 25 && !applySkipped ? 1 : 0);

  return (
    <div className="wrap pad"><div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="crumbs"><button onClick={onBack} style={{ color: "#F2600C" }}>← Missions</button><span className="sep">/</span><b>{m.title}</b></div>
      <h1 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, lineHeight: 1.1, marginBottom: 10 }}>{m.title}</h1>

      <div className="card" style={{ borderColor: "#3E4556", marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 7 }}>
          <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#F4A623", fontFamily: "Space Grotesk", fontWeight: 600 }}>📌 Your real task</div>
          <button className={"listenbtn" + (speaking ? " on" : "")} onClick={speaking ? hush : listen}>{speaking ? "⏹ Stop" : "▶ Listen"}</button>
        </div>
        <p style={{ fontSize: 14, color: "#D7DCE4" }}>{m.real}</p>
      </div>

      <div className="phase">① Learn it</div>
      <div className="card" style={{ marginBottom: 22 }}>
        <h4 style={{ fontFamily: "Space Grotesk", fontSize: 15.5, marginBottom: 6 }}>{m.learn.concept}</h4>
        <p style={{ fontSize: 14, color: "#AEB6C4" }}>{m.learn.body}</p>
      </div>

      <div className="phase">② Do it — in Claude</div>
      {m.doIt && (
        <div className="card" style={{ marginBottom: 16, borderColor: "#3E4556" }}>
          <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#F4A623", fontFamily: "Space Grotesk", fontWeight: 600, marginBottom: 6 }}>🟠 Do this in Claude</div>
          <p style={{ fontSize: 13.5, color: "#D7DCE4" }}>{m.doIt}</p>
        </div>
      )}
      {m.steps.map((s: any, i: number) => (<div className="stepcard" key={i}><div className="sn">{s.n}</div><h4>{s.h}</h4><p>{s.p}</p></div>))}
      <div className="promptbox"><span className="lbl">▸ Paste into Claude</span>
        <button className="cp" onClick={() => navigator.clipboard?.writeText(m.prompt)}>Copy</button>{m.prompt}</div>

      <div className="phase" style={{ marginTop: 24 }}>③ Validate — run TRACE</div>
      <TraceWidget trace={trace} onScored={setTraceScore} />

      <div className="phase" style={{ marginTop: 24 }}>④ Spot the good one</div>
      <p style={{ fontSize: 13.5, color: "#AEB6C4", marginBottom: 4 }}>{m.spot.q}</p>
      <div className="spot">{["good", "bad"].map((side) => {
        const o = m.spot[side], picked = spotPick === side;
        const cls = !spotDone ? "" : o.correct ? "reveal-correct show" : picked ? "picked-bad show" : "";
        return <button key={side} className={"sp " + cls + (picked && o.correct ? " picked-good" : "")} disabled={spotDone} onClick={() => setSpotPick(side)}>
          <div className="tag">{spotDone ? (o.correct ? "✓ The right move" : "✕ Don't trust this") : "Option " + (side === "good" ? "A" : "B")}</div>
          <div className="txt">{o.txt}</div><div className="verdict" style={{ color: o.correct ? "#33B06A" : "#D8503A" }}>{o.verdict}</div></button>;
      })}</div>

      <div className="phase" style={{ marginTop: 24 }}>⑤ Quick check</div>
      {m.quiz.map((q: any, i: number) => (
        <div className="quiz" key={i}><div className="qq">{q.q}</div>
          {q.opts.map((o: string, oi: number) => {
            const chosen = qi[i] === oi, answered = qi[i] !== undefined;
            const cls = !answered ? "" : oi === q.a ? "correct" : chosen ? "wrong" : "";
            return <button key={oi} className={"opt " + cls} disabled={answered} onClick={() => answered || setQi({ ...qi, [i]: oi })}>
              <span className="key">{answered && oi === q.a ? "✓" : answered && chosen ? "✕" : ["A", "B", "C", "D"][oi]}</span><span>{o}</span></button>;
          })}
          {qi[i] !== undefined && <div className="explain" dangerouslySetInnerHTML={{ __html: (qi[i] === q.a ? "<b>Spot on. </b>" : "<b>Not quite. </b>") + q.ex }} />}
        </div>
      ))}

      {m.apply && <>
        <div className="phase" style={{ marginTop: 24 }}>⑥ Now do it on your real work</div>
        <div className="apply"><div className="at">🔧 Your turn — for real</div><p className="aq">{m.apply.q}</p>
          <textarea placeholder={m.apply.placeholder} value={applyText} onChange={(e) => { setApplyText(e.target.value); if (applySkipped) setApplySkipped(false); }} />
          <div className="meta">{applyText.trim().length >= 25 ? <span className="ok">✓ Logged — this makes you faster tomorrow</span> : <span className="count">{applyText.trim().length}/25 — a real attempt unlocks completion</span>}
            {applyText.trim().length < 25 && <button className="skip" onClick={() => setApplySkipped(true)}>Skip — I'll do this after</button>}</div></div>
      </>}

      {m.keep && <div className="keep"><div className="kt">⭐ Keep this — your reusable {m.keep.label}</div><p className="kd">{m.keep.desc}</p>
        <div className="kbox"><button className="cp" onClick={() => navigator.clipboard?.writeText(m.keep.text)}>Copy</button>{m.keep.text}</div></div>}

      {canFinish ? <div className="feedback">
        {stars > 0 && <div style={{ marginBottom: 14 }}><span className="scorechip"><span className="star">{"★".repeat(stars)}{"☆".repeat(3 - stars)}</span> Mastery {stars}/3</span></div>}
        <h4>🏁 Before you go — be honest</h4>
        <p className="fp">Could you do this real task tomorrow, without this app open?</p>
        <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
          {[["yes", "💪 Yes"], ["nearly", "🤔 Nearly"], ["no", "😅 Not yet"]].map(([v, lab]) => (
            <button key={v} className="btn ghost sm" style={fb === v ? { borderColor: "#F2600C", color: "#F2600C" } : {}} onClick={() => setFb(v)}>{lab}</button>))}
        </div>
        <textarea placeholder="Anything that clicked or confused you? (optional)" value={fbText} onChange={(e) => setFbText(e.target.value)} style={{ width: "100%", background: "#14161C", border: "1px solid #323847", borderRadius: 9, padding: 11, color: "#F3F4F7", minHeight: 56 }} />
        <div style={{ display: "flex", gap: 10, marginTop: 13 }}>
          <button className="btn" disabled={fb === null} onClick={() => onComplete(m.id, { confidence: fb, stars, applied: m.apply && applyText.trim().length >= 25 && !applySkipped, quiz: quizScore + "/" + m.quiz.length, note: fbText.trim() })}>✓ Complete mission</button>
          <button className="btn ghost" onClick={onBack}>Save & exit</button>
        </div>
      </div> : <p style={{ fontSize: 12.5, color: "#8B94A4", textAlign: "center", marginTop: 18 }}>Finish the steps above to complete this mission.</p>}
    </div></div>
  );
}
