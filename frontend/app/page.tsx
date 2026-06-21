"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import { speak, stopSpeak } from "@/lib/voice";

declare global { interface Window { google?: any; } }

const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null); // {people,trace,toolGuide,missions}
  const [view, setView] = useState<"pick" | "map" | "mission" | "dash">("pick");
  const [persona, setPersona] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
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
      setView("map");
    }
  }, [user, persona]);

  if (loading) return <Splash />;
  if (!user) return <Login onUser={setUser} clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ""} setErr={setErr} err={err} />;
  if (!data) return <Splash msg="Loading the pond…" />;

  const people = data.people, missions = data.missions, trace = data.trace, toolGuide = data.toolGuide;

  async function pickPersona(id: string) {
    setPersona(id);
    try { await api.setPersona(id); } catch {}
  }
  function toggleRead() {
    setReadAloud((s) => { const n = !s; try { localStorage.setItem("duckpond.read", n ? "on" : "off"); } catch {} if (!n) stopSpeak(); return n; });
  }
  async function onComplete(mid: string, fb: any) {
    try {
      await api.complete({ persona, mission_id: mid, ...fb });
      const p = await api.progress(persona!);
      setCompleted(p.completed);
    } catch (e: any) { setErr(e.message); }
    setView("map");
  }

  return (
    <div>
      <Header user={user} persona={persona} readAloud={readAloud} toggleRead={toggleRead}
        onSwitch={() => { setPersona(null); setView("pick"); }}
        completed={completed} total={persona ? missions[persona].length : 0} />
      <main>
        {view === "pick" && <Pick people={people} onPick={pickPersona} />}
        {view === "map" && persona && (
          <Map persona={persona} people={people} missions={missions} completed={completed}
            isAdmin={user.is_admin}
            onOpen={(mid: string) => { setActiveMid(mid); setView("mission"); }}
            onDash={() => setView("dash")} />
        )}
        {view === "mission" && persona && activeMid && (
          <Mission m={missions[persona].find((x: any) => x.id === activeMid)} trace={trace}
            toolGuide={toolGuide} readAloud={readAloud}
            onBack={() => setView("map")} onComplete={onComplete} />
        )}
        {view === "dash" && <Dashboard people={people} missions={missions} />}
      </main>
      <footer className="foot"><div className="wrap">The Duck Pond 🦆 · grounded in your real Project Lists tasks · Claude + Codex · your data is saved centrally</div></footer>
    </div>
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

function Map({ persona, people, missions, completed, isAdmin, onOpen, onDash }: any) {
  const p = people[persona], list = missions[persona], nextIdx = completed.length;
  return (
    <div className="wrap pad">
      <div className="secthead">
        <div><div className="eyebrow">Your missions</div><h2>Real tasks, {p.name} — done with AI, validated by you</h2></div>
        {isAdmin && <button className="btn ghost sm" onClick={onDash}>📊 Team dashboard</button>}
      </div>
      <div className="missions">
        {list.map((m: any, i: number) => {
          const done = completed.includes(m.id), locked = i > nextIdx;
          return (
            <div key={m.id} className={"mission" + (locked ? " locked" : "")}>
              <div className="m-head" onClick={() => !locked && onOpen(m.id)} style={{ cursor: locked ? "default" : "pointer" }}>
                <div className="m-no" style={{ color: m.colour, borderColor: m.colour }}>{done ? "✓" : i + 1}</div>
                <div className="m-meta"><div className="k">{m.phase}</div><h3>{m.title}</h3>
                  <div className="real">📌 {m.real.length > 96 ? m.real.slice(0, 96) + "…" : m.real}</div></div>
                <div className="m-right">{locked ? <span className="mono" style={{ fontSize: 11, color: "#8B94A4" }}>🔒</span> : <span style={{ color: m.colour }}>{done ? "Revisit" : "Start ▸"}</span>}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mission({ m, trace, toolGuide, readAloud, onBack, onComplete }: any) {
  const [traceOn, setTraceOn] = useState<any>({});
  const [spotPick, setSpotPick] = useState<string | null>(null);
  const [qi, setQi] = useState<any>({});
  const [applyText, setApplyText] = useState("");
  const [applySkipped, setApplySkipped] = useState(false);
  const [fb, setFb] = useState<string | null>(null);
  const [fbText, setFbText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const tg = { ...toolGuide._default, ...(toolGuide[m.id] || {}) };

  const readScript = `Your real task. ${m.real}. Here's the idea: ${m.learn.concept}. ${m.learn.body}. To do it: ${m.steps.map((s: any) => s.h + ". " + s.p).join(" ")}`;
  function listen() { setSpeaking(true); speak(readScript, () => setSpeaking(false)); }
  function hush() { stopSpeak(); setSpeaking(false); }
  useEffect(() => { if (readAloud) { const id = setTimeout(listen, 350); return () => { clearTimeout(id); stopSpeak(); }; } return () => stopSpeak(); }, [m.id, readAloud]);

  const quizDone = m.quiz.every((_: any, i: number) => qi[i] !== undefined);
  const quizScore = m.quiz.reduce((s: number, q: any, i: number) => s + (qi[i] === q.a ? 1 : 0), 0);
  const spotDone = spotPick !== null;
  const spotCorrect = spotDone && m.spot[spotPick!]?.correct;
  const traceReady = !m.trace || Object.keys(traceOn).filter((k) => traceOn[k]).length === 5;
  const applyMet = !m.apply || applyText.trim().length >= 25 || applySkipped;
  const canFinish = quizDone && spotDone && (!m.trace || traceReady) && applyMet;
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

      <div className="phase">② Do it — Claude or Codex?</div>
      <div className="tools">
        <div className="tool claude"><div className="th"><span className="tdot" />🟠 Claude</div><p>{tg.claude.use}</p><span className="pick">{tg.claude.pick}</span></div>
        <div className="tool codex"><div className="th"><span className="tdot" />🔵 Codex</div><p>{tg.codex.use}</p><span className="pick">{tg.codex.pick}</span></div>
      </div>
      {m.steps.map((s: any, i: number) => (<div className="stepcard" key={i}><div className="sn">{s.n}</div><h4>{s.h}</h4><p>{s.p}</p></div>))}
      <div className="promptbox"><span className="lbl">▸ Paste into Claude (or adapt for Codex)</span>
        <button className="cp" onClick={() => navigator.clipboard?.writeText(m.prompt)}>Copy</button>{m.prompt}</div>

      {m.trace && <>
        <div className="phase" style={{ marginTop: 24 }}>③ Validate — run TRACE</div>
        <div className="traceboard">{trace.map(([k, name, desc, col]: any) => (
          <button key={k} className={"trow" + (traceOn[k] ? " on" : "")} onClick={() => setTraceOn({ ...traceOn, [k]: !traceOn[k] })}>
            <div className="tk" style={{ background: col }}>{k}</div><div className="tt"><h5>{name}</h5><span>{desc}</span></div>
            <div className="chk">{traceOn[k] ? "✓" : ""}</div></button>))}
        </div>
      </>}

      <div className="phase" style={{ marginTop: 24 }}>{m.trace ? "④" : "③"} Spot the good one</div>
      <p style={{ fontSize: 13.5, color: "#AEB6C4", marginBottom: 4 }}>{m.spot.q}</p>
      <div className="spot">{["good", "bad"].map((side) => {
        const o = m.spot[side], picked = spotPick === side;
        const cls = !spotDone ? "" : o.correct ? "reveal-correct show" : picked ? "picked-bad show" : "";
        return <button key={side} className={"sp " + cls + (picked && o.correct ? " picked-good" : "")} disabled={spotDone} onClick={() => setSpotPick(side)}>
          <div className="tag">{spotDone ? (o.correct ? "✓ The right move" : "✕ Don't trust this") : "Option " + (side === "good" ? "A" : "B")}</div>
          <div className="txt">{o.txt}</div><div className="verdict" style={{ color: o.correct ? "#33B06A" : "#D8503A" }}>{o.verdict}</div></button>;
      })}</div>

      <div className="phase" style={{ marginTop: 24 }}>{m.trace ? "⑤" : "④"} Quick check</div>
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
        <div className="phase" style={{ marginTop: 24 }}>{m.trace ? "⑥" : "⑤"} Now do it on your real work</div>
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

function Dashboard({ people, missions }: any) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [props, setProps] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadProps() { try { setProps(await api.proposals("pending")); } catch {} }
  useEffect(() => { api.dashboard().then(setD).catch((e) => setErr(e.message)); loadProps(); }, []);

  async function runNow() {
    setRunning(true); setMsg("");
    try { const r = await api.runAgents(); setMsg(r.summary || "Done"); await loadProps(); }
    catch (e: any) { setMsg(e.message); }
    setRunning(false);
  }
  async function decide(id: number, decision: "approved" | "rejected") {
    await api.decideProposal(id, decision);
    setProps((p) => p.filter((x) => x.id !== id));
  }

  if (err) return <div className="wrap pad"><p style={{ color: "#D8503A" }}>{err}</p></div>;
  if (!d) return <div className="wrap pad"><p style={{ color: "#8B94A4" }}>Loading team data…</p></div>;
  return (
    <div className="wrap pad">
      <div className="secthead"><div><div className="eyebrow">Oversight</div><h2>How the team's tracking</h2></div></div>
      <div className="dash-grid">
        <div className="stat"><div className="n">{d.feedback.length}</div><div className="l">Missions completed</div></div>
        <div className="stat"><div className="n" style={{ color: "#33B06A" }}>{d.applied_total}</div><div className="l">Applied to real work</div></div>
        <div className="stat"><div className="n" style={{ color: d.not_yet_total ? "#F4A623" : "#33B06A" }}>{d.not_yet_total}</div><div className="l">"Not yet" confidence</div></div>
      </div>

      {/* Self-improvement engine */}
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

      <div className="eyebrow" style={{ margin: "26px 0 11px" }}>What the feedback is telling us</div>
      <div className="card">
        {d.feedback.length === 0 ? <p style={{ color: "#AEB6C4" }}>No feedback yet.</p> :
          d.feedback.slice().reverse().slice(0, 12).map((f: any, i: number) => {
            const mm = missions[f.persona]?.find((x: any) => x.id === f.mission_id);
            const conf: any = { yes: ["💪", "Confident"], nearly: ["🤔", "Nearly"], no: ["😅", "Not yet"] }[f.confidence] || ["•", ""];
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
