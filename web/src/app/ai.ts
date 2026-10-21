// Optional AI coach over any OpenAI-compatible chat endpoint (Groq, OpenAI,
// OpenRouter, LM Studio, …), called straight from the browser with the user's
// own key. Everything else in the app works without it.
//
// The key lives only in this device's localStorage: it is never synced, so a
// leaked sync record can't expose it and each device opts in on its own.

import { type CoachDetail, DETAIL_LEVELS } from "../domain/profile/coach";

export interface AiProvider {
  label: string;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  keyHint: string;
  helpUrl: string;
}

export const AI_PROVIDERS: Record<string, AiProvider> = {
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    keyHint: "gsk_…",
    helpUrl: "https://console.groq.com/keys",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
    keyHint: "sk-…",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
    needsKey: true,
    keyHint: "sk-or-…",
    helpUrl: "https://openrouter.ai/keys",
  },
  lmstudio: {
    label: "LM Studio (lokal)",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    needsKey: false,
    keyHint: "nicht nötig",
    helpUrl: "https://lmstudio.ai",
  },
  custom: {
    label: "Eigener Server",
    baseUrl: "",
    model: "",
    needsKey: false,
    keyHint: "falls nötig",
    helpUrl: "",
  },
};

export interface AiConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** How much of the player's data goes into a prompt. */
  detail?: CoachDetail;
}

/** Local models often run with a 4k context window, so they start compact. */
export function defaultDetail(provider: string): CoachDetail {
  return provider === "lmstudio" || provider === "custom" ? "compact" : "normal";
}

export function detailOf(c: AiConfig): CoachDetail {
  return c.detail && c.detail in DETAIL_LEVELS ? c.detail : defaultDetail(c.provider);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "schach.ai";

export function loadAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<AiConfig>;
    if (typeof c.baseUrl !== "string" || typeof c.model !== "string") return null;
    const provider = c.provider ?? "custom";
    const detail = c.detail && c.detail in DETAIL_LEVELS ? c.detail : defaultDetail(provider);
    return { provider, baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey ?? "", detail };
  } catch {
    return null;
  }
}

export function saveAiConfig(c: AiConfig | null): void {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the coach just stays off.
  }
  window.dispatchEvent(new Event("schach-ai-changed"));
}

export function aiReady(c: AiConfig | null): c is AiConfig {
  if (!c || !c.baseUrl.trim() || !c.model.trim()) return false;
  const p = AI_PROVIDERS[c.provider];
  return !(p?.needsKey && !c.apiKey.trim());
}

/** Splits a server-sent-events buffer into complete `data:` payloads and the unfinished rest. */
export function parseSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    if (lines.length) data.push(lines.map((l) => l.slice(5).trimStart()).join("\n"));
  }
  return { data, rest };
}

function deltaOf(payload: string): string {
  try {
    const j = JSON.parse(payload);
    return j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

export class AiError extends Error {}

function friendlyError(status: number, body: string): string {
  if (status === 401 || status === 403) return "Der API-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.";
  if (status === 404) return "Modell oder Adresse nicht gefunden. Prüfe Modellname und Server-Adresse.";
  if (status === 400 && /context|token|length/i.test(body)) {
    return "Die Anfrage ist zu lang für das Modell. Stelle in den Einstellungen die Datenmenge auf „Kompakt“ oder erhöhe die Kontextlänge des Modells.";
  }
  if (status === 429) return "Zu viele Anfragen oder Kontingent aufgebraucht. Versuche es gleich noch einmal.";
  const msg = /"message"\s*:\s*"([^"]{1,200})"/.exec(body)?.[1];
  return `Der KI-Dienst meldet Fehler ${status}${msg ? `: ${msg}` : ""}.`;
}

/**
 * Streams a chat completion; `onDelta` receives the text so far.
 * Falls back to a non-streamed answer when the server ignores `stream`.
 */
export async function streamChat(
  cfg: AiConfig,
  messages: ChatMessage[],
  onDelta: (textSoFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        temperature: 0.4,
        max_tokens: DETAIL_LEVELS[detailOf(cfg)].maxTokens,
      }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AiError(
      navigator.onLine
        ? "Der KI-Dienst ist nicht erreichbar. Manche Anbieter erlauben keine Aufrufe direkt aus dem Browser."
        : "Du bist offline. Der KI-Coach braucht eine Internetverbindung.",
    );
  }
  if (!res.ok) throw new AiError(friendlyError(res.status, await res.text().catch(() => "")));

  const type = res.headers.get("content-type") ?? "";
  if (!res.body || !type.includes("event-stream")) {
    const text = deltaOf(await res.text());
    onDelta(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { data, rest } = parseSse(buffer);
    buffer = rest;
    for (const d of data) {
      if (d === "[DONE]") continue;
      text += deltaOf(d);
    }
    onDelta(text);
  }
  return text;
}
