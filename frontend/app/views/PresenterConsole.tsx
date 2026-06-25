"use client";
/**
 * PresenterConsole — the SEPARATE presenter window. Opened from the main
 * Presentation view ("🖥 Presenter view"); it shares the signed-in session
 * (token lives in localStorage) and loads the deck itself, then stays in sync
 * with the slide window via lib/presentSync. Whichever window you navigate in,
 * both move together.
 *
 * Routed from page.tsx when the URL has ?presenter=<sessionId>, before the
 * login/persona gates — it needs no persona, just the deck.
 *
 * Shows the presenter what they need and the audience never sees: the current
 * slide's speaker notes (big), the live-demo cue, a preview of the next slide,
 * a slide counter, a session timer and the wall clock.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { speak, stopSpeak } from "@/lib/voice";
import { publish, subscribe, readState } from "@/lib/presentSync";

type Slide = { title: string; body: string; notes?: string; demo?: string; visual?: string };
type Deck = { title: string; subtitle?: string; slides: Slide[] };

// Strip the light markdown markers for a clean preview of slide bodies.
function plain(text: string): string {
  return (text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[>\-*]\s+/gm, "");
}

function clock(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function elapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function PresenterConsole({ sid }: { sid: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [err, setErr] = useState("");
  const [idx, setIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const startedAt = useRef(Date.now());

  // Load the deck (authenticated via the shared token).
  useEffect(() => {
    (async () => {
      try {
        const data = await api.missions();
        const d = (data.presentation || {})[sid];
        if (!d) setErr("This session has no presenter deck.");
        else setDeck(d);
      } catch {
        setErr("Couldn't load the deck. Sign in on the main window first, then reopen the presenter view.");
      }
    })();
  }, [sid]);

  // Jump to the slide window's current position on open, then keep in sync.
  useEffect(() => {
    const s = readState();
    if (s && s.sid === sid) setIdx(s.idx);
    return subscribe((st) => { if (st.sid === sid) setIdx((i) => (i === st.idx ? i : st.idx)); });
  }, [sid]);

  const total = deck?.slides.length || 0;

  // Broadcast our position so the slide window follows.
  useEffect(() => { if (deck) publish(sid, idx); }, [idx, sid, deck]);

  // Tick the clock / timer once a second.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Stop read-aloud on slide change / unmount.
  useEffect(() => { stopSpeak(); setSpeaking(false); return () => stopSpeak(); }, [idx]);

  const go = (delta: number) => setIdx((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const cur = deck?.slides[idx];
  const next = deck?.slides[idx + 1];
  const elapsedStr = useMemo(() => elapsed(now.getTime() - startedAt.current), [now]);

  function readNotes() {
    if (!cur?.notes) return;
    setSpeaking(true);
    speak(cur.notes, () => setSpeaking(false));
  }

  if (err) {
    return <div className="pc"><div className="pc-empty"><p>{err}</p></div></div>;
  }
  if (!deck || !cur) {
    return <div className="pc"><div className="pc-empty"><p>Loading the deck…</p></div></div>;
  }

  return (
    <div className="pc">
      <div className="pc-bar">
        <span className="pc-tag">🖥 Presenter view</span>
        <div className="pc-deck">{deck.title}</div>
        <div className="pc-bar-sp" />
        <div className="pc-meta">
          <span className="pc-counter">{idx + 1} / {total}</span>
          <span className="pc-time" title="Time since you opened the presenter view">⏱ {elapsedStr}</span>
          <span className="pc-clock">{clock(now)}</span>
        </div>
      </div>

      <div className="pc-grid">
        {/* Left: the speaker notes — the main thing the presenter reads */}
        <div className="pc-notes-col">
          <div className="pc-now-title">Slide {idx + 1}: {cur.title}</div>
          {cur.demo && (
            <div className="pc-demo">
              <div className="pc-demo-h">▶ Demo — run this live</div>
              <p>{cur.demo}</p>
            </div>
          )}
          <div className="pc-notes-h">
            🗒 Speaker notes
            <button className={"pc-read" + (speaking ? " on" : "")} onClick={speaking ? () => { stopSpeak(); setSpeaking(false); } : readNotes} disabled={!cur.notes}>
              {speaking ? "⏹ Stop" : "🔊 Read aloud"}
            </button>
          </div>
          <div className="pc-notes">{cur.notes || "— no notes for this slide —"}</div>
        </div>

        {/* Right: what's on screen now, and what's next */}
        <div className="pc-side">
          <div className="pc-side-h">On screen now</div>
          <div className="pc-preview">
            {cur.visual && <div className="pc-preview-visual">{cur.visual}</div>}
            <div className="pc-preview-title">{cur.title}</div>
            <div className="pc-preview-body">{plain(cur.body).split("\n").filter(Boolean).slice(0, 7).map((l, i) => <div key={i}>{l}</div>)}</div>
          </div>
          <div className="pc-side-h next">Next →</div>
          <div className="pc-next">
            {next ? (
              <>
                <div className="pc-next-title">{next.title}</div>
                <div className="pc-next-body">{plain(next.body).split("\n").filter(Boolean)[0] || ""}</div>
              </>
            ) : (
              <div className="pc-next-end">End of deck — “Start the missions →” on the slide window.</div>
            )}
          </div>
        </div>
      </div>

      <div className="pc-foot">
        <button className="pc-nav" onClick={() => go(-1)} disabled={idx === 0}>← Prev</button>
        <div className="pc-foot-hint">Arrow keys move both windows · this window is yours, the other is on screen</div>
        <button className="pc-nav primary" onClick={() => go(1)} disabled={idx >= total - 1}>Next →</button>
      </div>
    </div>
  );
}
