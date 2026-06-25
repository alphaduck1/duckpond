"use client";
/**
 * Presentation — the live presenter deck Callum delivers BEFORE the team
 * practices the missions. Full-screen, dark, big type, centred.
 *
 * IMPORT (page.tsx):
 *   import Presentation from "@/app/views/Presentation";
 *
 * PROPS:
 *   {
 *     deck: Deck;                  // data.presentation[sessionId]
 *     onExit: () => void;          // close, back to the Session Hub
 *     onStartMissions: () => void; // jump the team into practice for this session
 *   }
 *
 * Deck shape (served by GET /api/missions under data.presentation):
 *   { title, subtitle, slides: [{ title, body, notes, demo?, visual? }] }
 *
 * Body is light markdown: **bold**, *italic*, `code`, "- " bullets and
 * "> " blockquotes, blank-line-separated paragraphs.
 *
 * Reuses the speak()/stopSpeak() read-aloud helpers from lib/voice and the
 * existing CSS tokens (--orange, --amber, --mute, etc).
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { speak, stopSpeak } from "@/lib/voice";
import { publish, subscribe } from "@/lib/presentSync";

type Slide = {
  title: string;
  body: string;
  notes?: string;
  demo?: string;
  visual?: string;
};
type Deck = {
  title: string;
  subtitle?: string;
  slides: Slide[];
};
type Props = {
  deck: Deck;
  sessionId: string;
  onExit: () => void;
  onStartMissions: () => void;
};

// ---- tiny inline markdown (bold / italic / code) ----
function inline(text: string): string {
  // escape first so user content can't inject markup
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
  return s;
}

// Render a markdown body block into legible presentation elements.
function Body({ text }: { text: string }) {
  const blocks = (text || "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="present-body">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const isList = lines.every((l) => /^[-*]\s+/.test(l));
        const isQuote = lines.every((l) => /^>\s?/.test(l));
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li} dangerouslySetInnerHTML={{ __html: inline(l.replace(/^[-*]\s+/, "")) }} />
              ))}
            </ul>
          );
        }
        if (isQuote) {
          const inner = lines.map((l) => l.replace(/^>\s?/, "")).join(" ");
          return <blockquote key={bi} dangerouslySetInnerHTML={{ __html: inline(inner) }} />;
        }
        return <p key={bi} dangerouslySetInnerHTML={{ __html: inline(lines.join(" ")) }} />;
      })}
    </div>
  );
}

export default function Presentation({ deck, sessionId, onExit, onStartMissions }: Props) {
  const slides = deck?.slides || [];
  const total = slides.length;
  const [idx, setIdx] = useState(0);
  const [notesOn, setNotesOn] = useState(true); // default ON for the presenter (single-screen)
  const [speaking, setSpeaking] = useState(false);
  const [presenterOpen, setPresenterOpen] = useState(false);
  const presenterWin = useRef<Window | null>(null);

  const cur = slides[idx];
  const isLast = idx === total - 1;

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => Math.min(Math.max(i + delta, 0), total - 1));
    },
    [total],
  );

  // Broadcast our slide so the popup presenter window follows; and follow it back.
  useEffect(() => { publish(sessionId, idx); }, [idx, sessionId]);
  useEffect(
    () => subscribe((s) => {
      if (s.sid === sessionId) setIdx((i) => (i === s.idx ? i : Math.min(Math.max(s.idx, 0), total - 1)));
    }),
    [sessionId, total],
  );

  // Open the speaker notes in a SEPARATE, synced window (the presenter console).
  function openPresenter() {
    const url = window.location.pathname + "?presenter=" + encodeURIComponent(sessionId);
    const w = window.open(url, "duckpond-presenter", "width=920,height=700");
    if (w) { presenterWin.current = w; setPresenterOpen(true); publish(sessionId, idx); }
  }
  // Notice if the presenter window is closed manually; close it when we exit.
  useEffect(() => {
    if (!presenterOpen) return;
    const t = setInterval(() => { if (presenterWin.current?.closed) setPresenterOpen(false); }, 1000);
    return () => clearInterval(t);
  }, [presenterOpen]);
  useEffect(() => () => { try { presenterWin.current?.close(); } catch {} }, []);

  // Stop any read-aloud whenever the slide changes or the view unmounts.
  useEffect(() => {
    stopSpeak();
    setSpeaking(false);
    return () => {
      stopSpeak();
    };
  }, [idx]);

  // Keyboard navigation: ← / → between slides, Esc to exit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit]);

  function readNotes() {
    if (!cur?.notes) return;
    setSpeaking(true);
    speak(cur.notes, () => setSpeaking(false));
  }
  function hush() {
    stopSpeak();
    setSpeaking(false);
  }

  if (!cur) {
    return (
      <div className="present">
        <div className="present-stage" style={{ placeItems: "center" }}>
          <div style={{ textAlign: "center", color: "var(--mute)" }}>
            <p>No slides for this session yet.</p>
            <button className="btn ghost" style={{ marginTop: 16 }} onClick={onExit}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="present">
      {/* Top bar: deck title, counter, controls */}
      <div className="present-bar">
        <div className="present-deck">
          <span className="present-dot" />
          <div>
            <div className="present-title">{deck.title}</div>
            {deck.subtitle && <small>{deck.subtitle}</small>}
          </div>
        </div>
        <div className="present-bar-sp" />
        <button
          className={"present-toggle" + (presenterOpen ? " on" : "")}
          onClick={openPresenter}
          title="Open your speaker notes in a separate window, kept in sync with the slides — share/​project this window, read notes on the other"
        >
          {presenterOpen ? "🖥 Presenter view open ↗" : "🖥 Presenter view"}
        </button>
        {!presenterOpen && (
          <button
            className={"present-toggle" + (notesOn ? " on" : "")}
            onClick={() => setNotesOn((v) => !v)}
            title="Show/hide the presenter's speaker notes on this screen"
          >
            {notesOn ? "🗒 Notes on" : "🗒 Notes off"}
          </button>
        )}
        <button
          className={"present-toggle read" + (speaking ? " on" : "")}
          onClick={speaking ? hush : readNotes}
          disabled={!cur.notes}
          title="Read the speaker notes aloud"
        >
          {speaking ? "⏹ Stop" : "🔊 Read aloud"}
        </button>
        <button className="present-exit" onClick={onExit}>
          ✕ Exit
        </button>
      </div>

      {/* The slide */}
      <div className="present-stage">
        <div className="present-slide" key={idx}>
          {cur.visual && <div className="present-visual">{cur.visual}</div>}
          <h1 className="present-h1">{cur.title}</h1>
          <Body text={cur.body} />
        </div>
      </div>

      {/* Speaker notes + demo panel (presenter-facing). Hidden on this screen
          when the separate presenter window is open, so this window stays clean
          for projecting/screen-sharing — notes live in the other window. */}
      {presenterOpen && (
        <div className="present-audience-tag">🖥 Presenter view is open in a separate window · this screen is audience-only · notes &amp; controls are synced</div>
      )}
      {notesOn && !presenterOpen && (
        <div className="present-notes">
          {cur.demo && (
            <div className="present-demo">
              <div className="present-demo-h">▶ Demo — run this live</div>
              <p>{cur.demo}</p>
            </div>
          )}
          <div className="present-notes-h">🗒 Speaker notes</div>
          <p className="present-notes-body">
            {cur.notes || "—"}
          </p>
        </div>
      )}

      {/* Bottom controls */}
      <div className="present-foot">
        <button className="present-nav" onClick={() => go(-1)} disabled={idx === 0}>
          ← Prev
        </button>

        <div className="present-mid">
          <div className="present-counter">
            {idx + 1} <span>/ {total}</span>
          </div>
          <div className="present-progress">
            <i style={{ width: total ? ((idx + 1) / total) * 100 + "%" : "0%" }} />
          </div>
        </div>

        {isLast ? (
          <button className="present-start" onClick={onStartMissions}>
            Start the missions →
          </button>
        ) : (
          <button className="present-nav primary" onClick={() => go(1)}>
            Next →
          </button>
        )}
      </div>

      {/* Persistent 'start the missions' shortcut for the presenter, always
          reachable without paging to the last slide. */}
      {!isLast && (
        <button className="present-skip" onClick={onStartMissions}>
          Skip to the missions →
        </button>
      )}
    </div>
  );
}
