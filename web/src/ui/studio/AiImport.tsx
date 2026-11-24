// "Mit KI erstellen": hands out a prompt for an external AI chat and turns its
// answer (the JSON script) into a finished video project.
import { useMemo, useState } from "preact/hooks";

import { buildAiPrompt, importAiScript, toAiScript, type VideoArt } from "./aiScript";
import { PLATFORM_LABEL, type Platform, type Side, type StudioProject } from "./model";
import { t, tj } from "../../i18n";

const LENGTHS = [15, 30, 45, 60, 90];
// Long YouTube lessons: about four minutes is the sweet spot Tim asked for.
const LONG_LENGTHS = [120, 180, 240, 300, 420];

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
  // Short vertical clips are mostly edits, so that is the default there (and the AI is told so); a YouTube video is a lesson unless asked otherwise.
  const [art, setArt] = useState<VideoArt | "auto">(current.style.view === "reel" || current.video.platform !== "youtube" ? "edit" : "auto");
  const [length, setLength] = useState(current.video.platform === "youtube" ? 240 : art === "edit" ? 30 : 45);
  const [notes, setNotes] = useState("");
  const [side, setSide] = useState<Side | "auto">("auto");
  const [copied, setCopied] = useState<"" | "prompt" | "script" | "failed">("");
  const [answer, setAnswer] = useState("");
  const prompt = useMemo(() => buildAiPrompt({ topic, platform, length, notes, side, type: art }), [topic, platform, length, notes, side, art]);
  const result = useMemo(() => (answer.trim() ? importAiScript(answer) : null), [answer]);

  const doCopy = async (text: string, what: "prompt" | "script") => setCopied((await copy(text)) ? what : "failed");
  const readFile = async (file: File) => setAnswer((await file.text()).slice(0, 200000));

  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide ai">
        <div class="ai-head">
          <h3>{t("Mit KI erstellen")}</h3>
          <div class="ai-steps">
            <button class={step === "prompt" ? "on" : ""} onClick={() => setStep("prompt")}>
              {tj("{x} Prompt für die KI", { x: <b>1</b> })}
            </button>
            <button class={step === "answer" ? "on" : ""} onClick={() => setStep("answer")}>
              {tj("{x} Antwort einfügen", { x: <b>2</b> })}
            </button>
          </div>
        </div>

        {step === "prompt" && (
          <div class="ai-body">
            <p class="muted small">
              
              {t("Sag kurz, was du willst. Kopier dann den Prompt in ChatGPT, Claude oder Gemini. Die KI schreibt das ganze Video: Züge, Kamera pro Zug, Texte, Sprechtext, Pfeile, Markierungen, Effekte und Tempo.")}
            </p>
            <label class="ai-field">
              <span>{t("Worum geht es?")}</span>
              <input value={topic} onInput={(e) => setTopic(e.currentTarget.value)} placeholder={t("z. B. Die Spanische Partie für Anfänger")} />
            </label>
            <div class="ai-row">
              <label class="ai-field">
                <span>{t("Plattform")}</span>
                <select class="studio-select" value={platform} onChange={(e) => {
                    const p = e.currentTarget.value as Platform;
                    setPlatform(p);
                    setLength(p === "youtube" ? 240 : art === "edit" ? 30 : 45);
                  }}>
                  {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <div class="ai-field">
                <span>{t("Länge")}</span>
                <div class="studio-speed">
                  {(platform === "youtube" ? LONG_LENGTHS : LENGTHS).map((l) => (
                    <button key={l} class={length === l ? "on" : ""} onClick={() => setLength(l)}>
                      {l >= 120 ? `${l / 60} min` : `${l} s`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div class="ai-field">
              <span>{t("Art des Videos")}</span>
              <div class="studio-speed">
                {(["auto", "explain", "edit"] as const).map((k) => (
                  <button key={k} class={art === k ? "on" : ""} onClick={() => setArt(k)} title={k === "edit" ? t("Schneller Clip im Reel-Stil: harte Schnitte im Takt, schräge Kamera, kaum Text") : k === "explain" ? t("Ruhiges Video mit Untertiteln und Sprechtext") : t("Die KI wählt nach Thema und Wunsch")}>
                    {k === "auto" ? t("KI entscheidet") : k === "explain" ? t("Erklärvideo") : t("Edit-Video")}
                  </button>
                ))}
              </div>
            </div>
            <div class="ai-field">
              <span>{t("Aus wessen Sicht?")}</span>
              <div class="studio-speed">
                {(["auto", "white", "black"] as const).map((k) => (
                  <button key={k} class={side === k ? "on" : ""} onClick={() => setSide(k)}>
                    {k === "auto" ? t("KI entscheidet") : k === "white" ? t("Weiß") : t("Schwarz")}
                  </button>
                ))}
              </div>
            </div>
            <label class="ai-field">
              <span>{t("Das soll die KI beachten (optional)")}</span>
              <textarea rows={4} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} placeholder={t("z. B. Zeig die Variante 3… Sf6\nViel Spannung, am Ende eine Umfrage\nSprechtext locker und per Du")} />
            </label>
            <details class="studio-fine">
              <summary>{t("Prompt ansehen")}</summary>
              <pre class="ai-prompt">{prompt}</pre>
            </details>
            <div class="studio-modal-actions">
              <button
                class="btn primary"
                onClick={async () => {
                  await doCopy(prompt, "prompt");
                }}
              >
                {copied === "prompt" ? t("✓ Kopiert") : t("Prompt kopieren")}
              </button>
              <button class="btn ghost" onClick={() => setStep("answer")}>
                
                {t("Weiter: Antwort einfügen")}
              </button>
              <button class="btn ghost" onClick={() => void doCopy(t("Überarbeite dieses Video-Skript und antworte im selben Format:\n\n{toAiScript}", { toAiScript: toAiScript(current) }), "script")} title={t("Das aktuelle Video als Skript, damit die KI es verbessert")}>
                {copied === "script" ? t("✓ Kopiert") : t("Aktuelles Video als Skript kopieren")}
              </button>
            </div>
            {copied === "failed" && <p class="studio-warn">{t("Kopieren ging nicht. Markier den Text unter „Prompt ansehen“ und kopier ihn von Hand.")}</p>}
          </div>
        )}

        {step === "answer" && (
          <div class="ai-body">
            <p class="muted small">{t("Füg die komplette Antwort der KI ein. Ich prüfe jeden Zug und zeige, was nicht passt.")}</p>
            <textarea class="wz-script ai-answer" rows={12} value={answer} onInput={(e) => setAnswer(e.currentTarget.value)} placeholder="```json { … } ```" spellcheck={false} />
            {result && (
              <div class="ai-check">
                {result.stats && (
                  <p class="ai-stats">
                    {tj("{scenes} Szenen · {moves} Züge", { scenes: <b>{result.stats.scenes}</b>, moves: <b>{result.stats.moves}</b> })}
                    {result.stats.variations ? (
                      <>
                        {" "}
                        {tj("· {variations} {n}", { variations: <b>{result.stats.variations}</b>, n: result.stats.variations === 1 ? t("Variante") : t("Varianten") })}
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
                {result.project && !result.errors.length && !result.warnings.length && <p class="ai-msg good">{t("Alles passt. Alle Züge sind legal.")}</p>}
              </div>
            )}
            <div class="studio-modal-actions">
              <button class="btn primary" disabled={!result?.project} onClick={() => result?.project && onCreate(result.project)}>
                
                {t("Video erstellen")}
              </button>
              <button class="btn ghost" disabled={!result?.project} onClick={() => result?.project && onReplace(result.project)} title={t("Ersetzt die Szenen und Einstellungen des offenen Videos")}>
                
                {t("Offenes Video ersetzen")}
              </button>
              <label class="btn ghost">
                
                {t("Datei …")}
                <input type="file" accept=".json,.txt,.md,application/json,text/plain" hidden onChange={(e) => e.currentTarget.files?.[0] && void readFile(e.currentTarget.files[0])} />
              </label>
              <button class="btn ghost" onClick={onClose}>
                
                {t("Abbrechen")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
