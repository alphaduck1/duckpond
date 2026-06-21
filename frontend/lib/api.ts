// Thin API client for the Duck Pond backend.
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("duckpond.token");
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed (${res.status})`);
  }
  return res;
}

export const api = {
  url: API,
  async login(credential: string) {
    const res = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    const data = await res.json();
    localStorage.setItem("duckpond.token", data.token);
    return data.user;
  },
  logout() {
    localStorage.removeItem("duckpond.token");
  },
  async me() {
    return (await req("/api/me")).json();
  },
  async setPersona(persona: string) {
    return (
      await req("/api/me/persona", {
        method: "POST",
        body: JSON.stringify({ persona }),
      })
    ).json();
  },
  async missions() {
    return (await req("/api/missions")).json();
  },
  async progress(persona: string) {
    return (await req(`/api/progress?persona=${persona}`)).json();
  },
  async complete(payload: any) {
    return (
      await req("/api/progress/complete", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    ).json();
  },
  async reset(persona: string) {
    return (
      await req(`/api/progress/reset?persona=${persona}`, { method: "POST" })
    ).json();
  },
  async dashboard() {
    return (await req("/api/dashboard")).json();
  },
  // --- self-improvement engine (admin) ---
  async runAgents() {
    return (await req("/api/agents/run", { method: "POST" })).json();
  },
  async proposals(status = "pending") {
    return (await req(`/api/proposals?status=${status}`)).json();
  },
  async decideProposal(id: number, decision: "approved" | "rejected") {
    return (await req(`/api/proposals/${id}/decide?decision=${decision}`, { method: "POST" })).json();
  },
  // Returns a playable audio URL, or null to signal browser-voice fallback.
  async ttsUrl(text: string): Promise<string | null> {
    try {
      const res = await fetch(`${API}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },
};
