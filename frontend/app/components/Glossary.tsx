"use client";
/**
 * Glossary tooltip layer (plan 3.4).
 *
 * IMPORT PATH:
 *   import { GlossaryProvider, Term } from "@/app/components/Glossary";
 *
 * PROPS:
 *   GlossaryProvider({ glossary, children })
 *     - glossary: GlossaryMap   // from /api/missions -> data.glossary
 *                               // shape: { [term: string]: { short: string; analogy: string } }
 *     - children: React.ReactNode
 *   Term({ word, children })
 *     - word: string            // glossary key to look up (case/space/punctuation-insensitive)
 *     - children?: React.ReactNode  // visible label; defaults to `word`
 *
 * NEW API CALLS: none. This component is a pure presentational layer that consumes the
 * already-fetched `data.glossary` object (no extra fetch). The integrator should mount
 * <GlossaryProvider glossary={data.glossary}> high in page.tsx (around <main>) and use
 * <Term word="agentic">agentic</Term> inline in mission `learn` bodies / copy.
 *
 * Dependency-free: a styled inline <span> trigger + an absolutely-positioned popover.
 * Shows {short} + the farm {analogy} on hover (desktop) and tap (touch). Reuses the
 * existing dark palette / fonts from globals.css via inline tokens so it matches the
 * current visual style without adding CSS classes.
 */
import {
  createContext,
  useContext,
  useState,
  useId,
  useRef,
  useEffect,
  type ReactNode,
} from "react";

export type GlossaryEntry = { short: string; analogy: string };
export type GlossaryMap = Record<string, GlossaryEntry>;

// Normalise keys so "LLM / model", "Agentic", "Right tool" all match a loose lookup.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type GlossaryCtx = { lookup: (word: string) => GlossaryEntry | null };
const Ctx = createContext<GlossaryCtx>({ lookup: () => null });

export function GlossaryProvider({
  glossary,
  children,
}: {
  glossary: GlossaryMap | null | undefined;
  children: ReactNode;
}) {
  // Build a normalised index once per glossary object.
  const index: Record<string, GlossaryEntry> = {};
  if (glossary) {
    for (const [k, v] of Object.entries(glossary)) {
      if (v && typeof v.short === "string" && typeof v.analogy === "string") {
        index[norm(k)] = v;
      }
    }
  }
  const lookup = (word: string): GlossaryEntry | null => index[norm(word)] ?? null;
  return <Ctx.Provider value={{ lookup }}>{children}</Ctx.Provider>;
}

export function Term({
  word,
  children,
}: {
  word: string;
  children?: ReactNode;
}) {
  const { lookup } = useContext(Ctx);
  const entry = lookup(word);
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Dismiss the popover on outside tap / Escape (touch + keyboard).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = children ?? word;

  // Unknown term: render plain text, no decoration, so copy never breaks.
  if (!entry) return <>{label}</>;

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-block", whiteSpace: "nowrap" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? popId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          font: "inherit",
          color: "#F4A623",
          fontWeight: 600,
          padding: 0,
          background: "none",
          border: "none",
          borderBottom: "1px dashed rgba(244,166,35,.55)",
          cursor: "help",
          lineHeight: "inherit",
          whiteSpace: "normal",
        }}
      >
        {label}
      </button>
      {open && (
        <span
          role="tooltip"
          id={popId}
          style={{
            position: "absolute",
            bottom: "calc(100% + 9px)",
            left: 0,
            zIndex: 70,
            width: "max-content",
            maxWidth: 280,
            whiteSpace: "normal",
            textAlign: "left",
            background: "#272C38",
            border: "1px solid #3E4556",
            borderRadius: 11,
            boxShadow: "0 8px 26px rgba(0,0,0,.30)",
            padding: "12px 14px",
            cursor: "default",
            animation: "pop .2s ease",
          }}
        >
          <span
            style={{
              display: "block",
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 12.5,
              color: "#F3F4F7",
              marginBottom: 5,
            }}
          >
            {String(label)}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              color: "#D7DCE4",
              lineHeight: 1.5,
              marginBottom: 7,
            }}
          >
            {entry.short}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 12,
              color: "#8B94A4",
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            🐑 {entry.analogy}
          </span>
          {/* little pointer */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "100%",
              left: 16,
              width: 10,
              height: 10,
              background: "#272C38",
              borderRight: "1px solid #3E4556",
              borderBottom: "1px solid #3E4556",
              transform: "translateY(-5px) rotate(45deg)",
            }}
          />
        </span>
      )}
    </span>
  );
}
