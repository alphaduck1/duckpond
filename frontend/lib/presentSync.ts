// presentSync — keep the presenter window and the audience (slide) window on the
// same slide. Two transports for browser coverage: BroadcastChannel where it
// exists, plus a localStorage key + `storage` events as a universal fallback.
// Neither transport echoes to the window that wrote it, so there's no self-loop.

export type PresentState = { sid: string; idx: number; ts: number };

const KEY = "duckpond.present.sync";
let bc: BroadcastChannel | null | undefined;

function chan(): BroadcastChannel | null {
  if (bc !== undefined) return bc;
  try { bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("duckpond-present") : null; }
  catch { bc = null; }
  return bc;
}

export function publish(sid: string, idx: number) {
  const s: PresentState = { sid, idx, ts: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  try { chan()?.postMessage(s); } catch {}
}

export function readState(): PresentState | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

// Subscribe to slide changes from the *other* window. Returns an unsubscribe fn.
export function subscribe(cb: (s: PresentState) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) { try { cb(JSON.parse(e.newValue)); } catch {} }
  };
  const onMsg = (e: MessageEvent) => {
    if (e?.data && typeof e.data.idx === "number" && typeof e.data.sid === "string") cb(e.data as PresentState);
  };
  window.addEventListener("storage", onStorage);
  const c = chan();
  c?.addEventListener("message", onMsg);
  return () => {
    window.removeEventListener("storage", onStorage);
    c?.removeEventListener("message", onMsg);
  };
}
