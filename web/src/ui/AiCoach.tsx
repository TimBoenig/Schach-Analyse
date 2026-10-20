import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { aiReady, type AiConfig, loadAiConfig, streamChat } from "../app/ai";
import type { CoachMessage } from "../domain/profile";
import { IconSpark } from "./icons";
import { navigate } from "./router";

export function useAiConfig(): AiConfig | null {
  const [cfg, setCfg] = useState(loadAiConfig);
  useEffect(() => {
    const on = () => setCfg(loadAiConfig());
    window.addEventListener("schach-ai-changed", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("schach-ai-changed", on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return aiReady(cfg) ? cfg : null;
}

function inline(text: string): ComponentChildren[] {
  // **bold** only; everything else stays plain text (no HTML from the model).
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/** Tiny Markdown subset for coach answers: ### headings, - lists, **bold**, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const out: ComponentChildren[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`l${out.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[-*•]\s+/.test(line)) {
      list.push(line.replace(/^[-*•]\s+/, ""));
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      list.push(line.replace(/^\d+[.)]\s+/, ""));
      continue;
    }
    flush();
    if (!line) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) out.push(<h4 key={`h${out.length}`}>{inline(h[1].replace(/\*\*/g, ""))}</h4>);
    else out.push(<p key={`p${out.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div class="md">{out}</div>;
}

export function AiSetupHint({ text }: { text: string }) {
  return (
    <div class="ai-hint">
      <span class="ai-badge">
        <IconSpark /> KI
      </span>
      <span class="small muted">{text}</span>
      <button class="btn small" onClick={() => navigate({ view: "settings" })}>
        Einrichten
      </button>
    </div>
  );
}

// Answers stay for the session, so going back to a game doesn't ask again.
const answerCache = new Map<string, string>();

/** One-shot coach answer for prepared messages (e.g. explain this game). */
export function AiAnswer({
  cacheKey,
  messages,
  title,
  start,
}: {
  cacheKey: string;
  messages: () => CoachMessage[];
  title: string;
  start: string;
}) {
  const cfg = useAiConfig();
  const [text, setText] = useState(answerCache.get(cacheKey) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setText(answerCache.get(cacheKey) ?? "");
    setError("");
    return () => abort.current?.abort();
  }, [cacheKey]);

  if (!cfg) return <AiSetupHint text="Lass dir die Partie von einem KI-Coach erklären." />;

  const run = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError("");
    setText("");
    try {
      const out = await streamChat(cfg, messages(), setText, ctl.signal);
      answerCache.set(cacheKey, out);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  return (
    <div class="ai-box">
      <div class="ai-head">
        <span class="ai-badge">
          <IconSpark /> KI-Coach
        </span>
        <strong>{title}</strong>
        <span class="spacer" />
        {busy ? (
          <button class="btn small ghost" onClick={() => abort.current?.abort()}>
            Stopp
          </button>
        ) : text ? (
          <button class="btn small ghost" onClick={run}>
            Neu fragen
          </button>
        ) : null}
      </div>
      {!text && !busy && !error && (
        <button class="btn primary block" onClick={run}>
          <IconSpark /> {start}
        </button>
      )}
      {busy && !text && <div class="ai-typing" aria-label="Der Coach schreibt">
        <span />
        <span />
        <span />
      </div>}
      {text && <Markdown text={text} />}
      {error && <p class="error small">{error}</p>}
      <p class="faint small ai-note">Die KI kennt nur die Analysewerte dieser App. Prüfe Ratschläge am Brett.</p>
    </div>
  );
}

/** Free-form chat about the profile, with suggested questions. */
export function AiChat({
  build,
  suggestions,
}: {
  build: (history: CoachMessage[], question: string) => CoachMessage[];
  suggestions: string[];
}) {
  const cfg = useAiConfig();
  const [history, setHistory] = useState<CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  // Follow the conversation, but never jump the page to the chat when it first renders.
  useEffect(() => {
    if (history.length || busy) end.current?.scrollIntoView({ block: "nearest" });
  }, [history.length, busy]);

  if (!cfg) return <AiSetupHint text="Stell einem KI-Coach Fragen zu deinem Profil, z. B. für einen Trainingsplan." />;

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setDraft("");
    setError("");
    setBusy(true);
    setPending("");
    const before = history;
    setHistory([...before, { role: "user", content: question }]);
    try {
      const answer = await streamChat(cfg, build(before, question), setPending, ctl.signal);
      setHistory([...before, { role: "user", content: question }, { role: "assistant", content: answer }]);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      setHistory(before);
      setDraft(question);
    } finally {
      setPending("");
      setBusy(false);
    }
  };

  return (
    <div class="ai-chat">
      {history.map((m, i) =>
        m.role === "user" ? (
          <div key={i} class="bubble me">
            {m.content}
          </div>
        ) : (
          <div key={i} class="bubble coach">
            <Markdown text={m.content} />
          </div>
        ),
      )}
      {busy && (
        <div class="bubble coach">
          {pending ? (
            <Markdown text={pending} />
          ) : (
            <div class="ai-typing">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}
      {error && <p class="error small">{error}</p>}
      <div ref={end} />
      {!history.length && !busy && (
        <div class="chips">
          {suggestions.map((s) => (
            <button key={s} class="chip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        class="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <input
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
          placeholder="Frag den Coach zu deinem Spiel …"
          aria-label="Frage an den KI-Coach"
          disabled={busy}
        />
        {busy ? (
          <button type="button" class="btn" onClick={() => abort.current?.abort()}>
            Stopp
          </button>
        ) : (
          <button type="submit" class="btn primary" disabled={!draft.trim()}>
            Fragen
          </button>
        )}
      </form>
    </div>
  );
}
