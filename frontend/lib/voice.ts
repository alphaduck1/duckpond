// Read-aloud: try the natural server voice (Google Cloud TTS) first,
// fall back to the browser's built-in voice if TTS isn't available.
import { api } from "./api";

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeak() {
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch {}
}

export async function speak(text: string, onEnd?: () => void) {
  stopSpeak();
  // 1) try server TTS (natural female voice)
  const url = await api.ttsUrl(text);
  if (url) {
    currentAudio = new Audio(url);
    currentAudio.onended = () => {
      onEnd?.();
      currentAudio = null;
    };
    currentAudio.play().catch(() => browserSpeak(text, onEnd));
    return;
  }
  // 2) fall back to the browser voice
  browserSpeak(text, onEnd);
}

function browserSpeak(text: string, onEnd?: () => void) {
  try {
    if (!window.speechSynthesis) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.98;
    u.pitch = 1.0;
    const vs = window.speechSynthesis.getVoices();
    // prefer a female-sounding English voice where possible
    const pick =
      vs.find((v) => /female|aoede|libby|sonia|aria/i.test(v.name) && /^en/i.test(v.lang)) ||
      vs.find((v) => /en-GB/i.test(v.lang)) ||
      vs.find((v) => /^en/i.test(v.lang));
    if (pick) u.voice = pick;
    u.onend = () => onEnd?.();
    window.speechSynthesis.speak(u);
  } catch {
    onEnd?.();
  }
}
