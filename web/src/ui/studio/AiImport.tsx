// "Mit KI erstellen": hands out a prompt for an external AI chat and turns its
// answer (the JSON script) into a finished video project.
import { useMemo, useState } from "preact/hooks";

import { buildAiPrompt, importAiScript, toAiScript } from "./aiScript";
import { PLATFORM_LABEL, type Platform, type StudioProject } from "./model";

const LENGTHS = [15, 30, 45, 60, 90];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AiImport({ current, onClose, onCreate, onReplace }: { current: StudioProject; onClose: () => void; onCreate: (p: StudioProject) => void; onReplace: (p: StudioProject) => void }) {
  const [step, setStep] = useState<"prompt" | "answer">("prompt");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<Platform>(current.video.platform);
  const [length, setLength] = useState(45);
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState<"" | "prompt" | "script" | "failed">("");
  const [answer, setAnswer] = useState("");
  const prompt = useMemo(() => buildAiPrompt({ topic, platform, length, notes }), [topic, platform, length, notes]);
  const result = useMemo(() => (answer.trim() ? importAiScript(answer) : null), [answer]);

  const doCopy = async (text: string, what: "prompt" | "script") => setCopied((await copy(text)) ? what : "failed");
  const readFile = async (file: File) => setAnswer((await file.text()).slice(0, 200000));

  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide ai">
        <div class="ai-head">
          <h3>Mit KI erstellen</h3>
          <div class="ai-steps">
            <button class={step === "prompt" ? "on" : ""} onClick={() => setStep("prompt")}>
              <b>1</b> Prompt für die KI
            </button>
            <button class={step === "answer" ? "on" : ""} onClick={() => setStep("answer")}>
              <b>2</b> Antwort einfügen
            </button>
          </div>
        </div>

        {step === "prompt" && (
          <div class="ai-body">
            <p class="muted small">
              Sag kurz, was du willst. Kopier dann den Prompt in ChatGPT, Claude oder Gemini. Die KI schreibt das ganze Video: Züge, Kamera pro Zug, Texte, Sprechtext, Pfeile, Markierungen, Effekte und
              Tempo.
            </p>
            <label class="ai-field">
              <span>Worum geht es?</span>
              <input value={topic} onInput={(e) => setTopic(e.currentTarget.value)} placeholder="z. B. Die Spanische Partie für Anfänger" />
            </label>
            <div class="ai-row">
              <label class="ai-field">
                <span>Plattform</span>
                <select class="studio-select" value={platform} onChange={(e) => setPlatform(e.currentTarget.value as Platform)}>
                  {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <div class="ai-field">
                <span>Länge</span>
                <div class="studio-speed">
                  {LENGTHS.map((l) => (
                    <button key={l} class={length === l ? "on" : ""} onClick={() => setLength(l)}>
                      {l} s
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label class="ai-field">
              <span>Das soll die KI beachten (optional)</span>
              <textarea rows={4} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} placeholder={"z. B. Zeig die Variante 3… Sf6\nViel Spannung, am Ende eine Umfrage\nSprechtext locker und per Du"} />
            </label>
            <details class="studio-fine">
              <summary>Prompt ansehen</summary>
              <pre class="ai-prompt">{prompt}</pre>
            </details>
            <div class="studio-modal-actions">
              <button
                class="btn primary"
                onClick={async () => {
                  await doCopy(prompt, "prompt");
                }}
              >
                {copied === "prompt" ? "✓ Kopiert" : "Prompt kopieren"}
              </button>
              <button class="btn ghost" onClick={() => setStep("answer")}>
                Weiter: Antwort einfügen
              </button>
              <button class="btn ghost" onClick={() => void doCopy(`Überarbeite dieses Video-Skript und antworte im selben Format:\n\n${toAiScript(current)}`, "script")} title="Das aktuelle Video als Skript, damit die KI es verbessert">
                {copied === "script" ? "✓ Kopiert" : "Aktuelles Video als Skript kopieren"}
              </button>
            </div>
            {copied === "failed" && <p class="studio-warn">Kopieren ging nicht. Markier den Text unter „Prompt ansehen“ und kopier ihn von Hand.</p>}
          </div>
        )}

        {step === "answer" && (
          <div class="ai-body">
            <p class="muted small">Füg die komplette Antwort der KI ein. Ich prüfe jeden Zug und zeige, was nicht passt.</p>
            <textarea class="wz-script ai-answer" rows={12} value={answer} onInput={(e) => setAnswer(e.currentTarget.value)} placeholder="```json { … } ```" spellcheck={false} />
            {result && (
              <div class="ai-check">
                {result.stats && (
                  <p class="ai-stats">
                    <b>{result.stats.scenes}</b> Szenen · <b>{result.stats.moves}</b> Züge
                    {result.stats.variations ? (
                      <>
                        {" "}
                        · <b>{result.stats.variations}</b> {result.stats.variations === 1 ? "Variante" : "Varianten"}
                      </>
                    ) : null}{" "}
                    · <b>{Math.round(result.stats.seconds)}</b> s
                  </p>
                )}
                {result.errors.map((e) => (
                  <p key={e} class="ai-msg bad">
                    {e}
                  </p>
                ))}
                {result.warnings.slice(0, 8).map((w) => (
                  <p key={w} class="ai-msg warn">
                    {w}
                  </p>
                ))}
                {result.project && !result.errors.length && !result.warnings.length && <p class="ai-msg good">Alles passt. Alle Züge sind legal.</p>}
              </div>
            )}
            <div class="studio-modal-actions">
              <button class="btn primary" disabled={!result?.project} onClick={() => result?.project && onCreate(result.project)}>
                Video erstellen
              </button>
              <button class="btn ghost" disabled={!result?.project} onClick={() => result?.project && onReplace(result.project)} title="Ersetzt die Szenen und Einstellungen des offenen Videos">
                Offenes Video ersetzen
              </button>
              <label class="btn ghost">
                Datei …
                <input type="file" accept=".json,.txt,.md,application/json,text/plain" hidden onChange={(e) => e.currentTarget.files?.[0] && void readFile(e.currentTarget.files[0])} />
              </label>
              <button class="btn ghost" onClick={onClose}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
