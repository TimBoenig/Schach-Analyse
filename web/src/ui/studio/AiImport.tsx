// "Mit KI erstellen": hands out a prompt for an external AI chat and turns its
// answer (the JSON script) into a finished video project.
import { useMemo, useState } from "preact/hooks";

import { buildAiPrompt, importAiScript, scenarioArt, SCENARIOS, toAiScript, type Ending, type Hook, type Level, type Pace, type Point, type PromptAnswers, type Scenario } from "./aiScript";
import { STYLE_IDS, STYLE_LABEL, type StyleId } from "./musicGen";
import { PLATFORM_LABEL, type Platform, type Side, type StudioProject } from "./model";
import { lang, t, tj } from "../../i18n";

const LENGTHS = [15, 30, 45, 60, 90];
// Long YouTube lessons: about four minutes is the sweet spot Tim asked for.
const LONG_LENGTHS = [120, 180, 240, 300, 420];

const SCENARIO_LABEL: Record<Scenario, string> = { edit: t("Edit (TikTok, Reels)"), explain: t("Kurzes Erklärvideo"), lesson: t("YouTube-Lektion"), opening: t("Eröffnung vorstellen"), puzzle: t("Rätsel / Taktik"), auto: t("KI entscheidet") };
const SCENARIO_HINT: Record<Scenario, string> = {
  edit: t("Schneller Clip im Reel-Stil: Schnitte im Takt, Hitstop, kaum Text, Beat-Musik"),
  explain: t("Eine Idee in 30 bis 60 Sekunden mit Untertiteln und Sprechtext"),
  lesson: t("Ruhige Lektion im Querformat mit Kapiteln, etwa vier Minuten"),
  opening: t("Hauptzüge mit der Idee dahinter, Pläne, eine Falle, Merksätze"),
  puzzle: t("Eine Aufgabe mit Countdown zum Mitdenken und Auflösung"),
  auto: t("Die KI wählt nach Thema und Wunsch"),
};

/** Defaults a scenario brings: the platform and length that fit it. */
function scenarioDefaults(sc: Scenario, platform: Platform): { platform: Platform; length: number } {
  if (sc === "lesson") return { platform: "youtube", length: 240 };
  const short = platform === "youtube" ? "tiktok" : platform;
  return { platform: sc === "auto" ? platform : short, length: sc === "edit" ? 30 : sc === "puzzle" ? 30 : sc === "opening" ? 60 : platform === "youtube" ? 240 : 45 };
}

/** One question: a row of buttons. */
function Ask<T extends string>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="ai-field">
      <span>{label}</span>
      <div class="studio-speed wrap">
        {options.map(([k, text]) => (
          <button key={k} class={value === k ? "on" : ""} onClick={() => onChange(k)}>
            {text}
          </button>
        ))}
      </div>
      {hint && <small class="muted">{hint}</small>}
    </div>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AiImport({ current, onClose, onCreate, onReplace }: { current: StudioProject; onClose: () => void; onCreate: (p: StudioProject) => void; onReplace: (p: StudioProject) => void }) {
  const [step, setStep] = useState<"questions" | "prompt" | "answer">("questions");
  // Short vertical clips are mostly edits, so that is the default there; a YouTube video is a lesson.
  const first: Scenario = current.style.view === "reel" || current.video.platform !== "youtube" ? "edit" : "lesson";
  const [scenario, setScenario] = useState<Scenario>(first);
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<Platform>(scenarioDefaults(first, current.video.platform).platform);
  const [length, setLength] = useState(scenarioDefaults(first, current.video.platform).length);
  const [notes, setNotes] = useState("");
  const [side, setSide] = useState<Side | "auto">("auto");
  const [game, setGame] = useState("");
  const [level, setLevel] = useState<Level>("beginner");
  const [pace, setPace] = useState<Pace>("normal");
  const [hook, setHook] = useState<Hook>("auto");
  const [ending, setEnding] = useState<Ending>("auto");
  const [point, setPoint] = useState<Point>("auto");
  const [music, setMusic] = useState<StyleId | "auto">("auto");
  const [language, setLanguage] = useState<"de" | "en">(lang());
  const [voice, setVoice] = useState(true);
  const [poll, setPoll] = useState(false);
  const [copied, setCopied] = useState<"" | "prompt" | "script" | "failed">("");
  const [answer, setAnswer] = useState("");
  const edit = scenario === "edit";
  const answers = useMemo<PromptAnswers>(
    () => ({ game, level, pace, hook, ending, language, ...(edit ? { point, music } : { voice, poll }) }),
    [game, level, pace, hook, ending, language, edit, point, music, voice, poll],
  );
  const prompt = useMemo(() => buildAiPrompt({ topic, platform, length, notes, side, scenario, answers }), [topic, platform, length, notes, side, scenario, answers]);
  const result = useMemo(() => (answer.trim() ? importAiScript(answer, { art: scenarioArt(scenario), platform, musicStyle: edit ? music : "auto", tighten: true }) : null), [answer, scenario, platform, edit, music]);

  const pick = (sc: Scenario) => {
    setScenario(sc);
    const d = scenarioDefaults(sc, platform);
    setPlatform(d.platform);
    setLength(d.length);
  };
  const doCopy = async (text: string, what: "prompt" | "script") => setCopied((await copy(text)) ? what : "failed");
  const readFile = async (file: File) => setAnswer((await file.text()).slice(0, 200000));

  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide ai">
        <div class="ai-head">
          <h3>{t("Mit KI erstellen")}</h3>
          <div class="ai-steps">
            <button class={step === "questions" ? "on" : ""} onClick={() => setStep("questions")}>
              {tj("{x} Fragen", { x: <b>1</b> })}
            </button>
            <button class={step === "prompt" ? "on" : ""} onClick={() => setStep("prompt")}>
              {tj("{x} Prompt für die KI", { x: <b>2</b> })}
            </button>
            <button class={step === "answer" ? "on" : ""} onClick={() => setStep("answer")}>
              {tj("{x} Antwort einfügen", { x: <b>3</b> })}
            </button>
          </div>
        </div>

        {step === "questions" && (
          <div class="ai-body">
            <p class="muted small">{t("Je genauer du antwortest, desto besser wird das Video. Alles ist optional: was du offen lässt, entscheidet die KI.")}</p>
            <div class="ai-field">
              <span>{t("Was für ein Video soll es werden?")}</span>
              <div class="studio-speed wrap">
                {SCENARIOS.map((k) => (
                  <button key={k} class={scenario === k ? "on" : ""} onClick={() => pick(k)} title={SCENARIO_HINT[k]}>
                    {SCENARIO_LABEL[k]}
                  </button>
                ))}
              </div>
              <small class="muted">{SCENARIO_HINT[scenario]}</small>
            </div>
            <label class="ai-field">
              <span>{t("Worum geht es?")}</span>
              <input value={topic} onInput={(e) => setTopic(e.currentTarget.value)} placeholder={scenario === "puzzle" ? t("z. B. Matt in 2 mit der Dame") : scenario === "opening" ? t("z. B. Die Italienische Partie für Weiß") : t("z. B. Die Spanische Partie für Anfänger")} />
            </label>
            <details class="studio-fine" open={game.trim() !== ""}>
              <summary>{t("Eigene Partie oder Stellung verwenden (optional)")}</summary>
              <label class="ai-field">
                <span>{t("PGN oder FEN einfügen: Die KI nimmt genau diese Züge und erfindet keine dazu")}</span>
                <textarea rows={4} value={game} onInput={(e) => setGame(e.currentTarget.value.slice(0, 4000))} placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 …" spellcheck={false} />
              </label>
            </details>
            <div class="ai-row">
              <label class="ai-field">
                <span>{t("Plattform")}</span>
                <select class="studio-select" value={platform} onChange={(e) => {
                    const p = e.currentTarget.value as Platform;
                    setPlatform(p);
                    setLength(p === "youtube" ? 240 : scenarioDefaults(scenario, p).length);
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
            <Ask<Side | "auto"> label={t("Aus wessen Sicht?")} value={side} onChange={setSide} options={[["auto", t("KI entscheidet")], ["white", t("Weiß")], ["black", t("Schwarz")]]} />
            <Ask<Level> label={t("Für wen ist das Video?")} value={level} onChange={setLevel} options={[["beginner", t("Anfänger")], ["club", t("Vereinsspieler")], ["strong", t("Fortgeschrittene")]]} />
            <Ask<Pace> label={t("Wie schnell soll es sein?")} value={pace} onChange={setPace} options={[["calm", t("Ruhiger")], ["normal", t("Normal")], ["fast", t("Sehr schnell")]]} />
            <Ask<Hook> label={t("Wie soll es beginnen (Hook)?")} value={hook} onChange={setHook} options={[["auto", t("KI entscheidet")], ["question", t("Frage")], ["bold", t("Mutige Behauptung")], ["result", t("Ergebnis zuerst")]]} />
            {edit && <Ask<Point> label={t("Was ist die Pointe?")} value={point} onChange={setPoint} options={[["auto", t("KI entscheidet")], ["mate", t("Matt")], ["sacrifice", t("Opfer")], ["blunder", t("Patzer")], ["turn", t("Wendepunkt")]]} />}
            {edit && <Ask<StyleId | "auto"> label={t("Welche Musik?")} value={music} onChange={setMusic} options={[["auto", t("Automatisch")], ...STYLE_IDS.map((k) => [k, STYLE_LABEL[k]] as [StyleId, string])]} hint={t("Das Studio erzeugt die Musik selbst. Die KI richtet Tempo und Stimmung danach aus.")} />}
            <Ask<Ending> label={t("Wie soll es enden?")} value={ending} onChange={setEnding} options={[["auto", t("KI entscheidet")], ["follow", t("Folgen-Aufruf")], ["question", t("Frage an die Zuschauer")], ["part2", t("Teil 2 ankündigen")], ["none", t("Ohne Aufruf")]]} />
            {!edit && <Ask<"yes" | "no"> label={t("Mit Sprechtext?")} value={voice ? "yes" : "no"} onChange={(v) => setVoice(v === "yes")} options={[["yes", t("Ja")], ["no", t("Nein, nur Untertitel")]]} />}
            {!edit && <Ask<"yes" | "no"> label={t("Mit Umfrage am Ende?")} value={poll ? "yes" : "no"} onChange={(v) => setPoll(v === "yes")} options={[["no", t("Nein")], ["yes", t("Ja")]]} />}
            <Ask<"de" | "en"> label={t("Sprache der Texte im Video")} value={language} onChange={setLanguage} options={[["de", t("Deutsch")], ["en", t("Englisch")]]} />
            <label class="ai-field">
              <span>{t("Das soll die KI beachten (optional)")}</span>
              <textarea rows={3} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} placeholder={t("z. B. Zeig die Variante 3… Sf6\nViel Spannung, am Ende eine Umfrage\nSprechtext locker und per Du")} />
            </label>
            <div class="studio-modal-actions">
              <button class="btn primary" onClick={() => setStep("prompt")}>
                {t("Weiter: Prompt erstellen")}
              </button>
              <button class="btn ghost" onClick={onClose}>
                {t("Abbrechen")}
              </button>
            </div>
          </div>
        )}

        {step === "prompt" && (
          <div class="ai-body">
            <p class="muted small">{t("Kopier den Prompt in ChatGPT, Claude oder Gemini und füg danach die Antwort ein. Deine Antworten aus Schritt 1 stehen schon drin.")}</p>
            <details class="studio-fine" open>
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
              <button class="btn ghost" onClick={() => setStep("questions")}>
                {t("Zurück zu den Fragen")}
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
