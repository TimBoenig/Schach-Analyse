// The "Edit" tab: everything that makes a short TikTok/Reels/Shorts edit work, in one place:
// shorten it (hook, middle, outro), curiosity hooks for the top edge, caption with a
// comment question, export tips. German and English side by side, because the same
// clip can be posted in both languages.
import { useMemo, useState } from "preact/hooks";

import { t, studioLang, LANG_NAMES, type Lang } from "../../i18n";
import { canTighten, captionKit, EDIT_TARGET_SECONDS, hookIdeas, hookStamps, keyMoveLabel, tightenEdit } from "./editTools";
import type { StudioProject } from "./model";
import { compile } from "./timeline";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function EditHelp({ project, onProject, onFirstTitle }: { project: StudioProject; onProject: (p: StudioProject) => void; onFirstTitle: (title: string) => void }) {
  const [lang, setLang] = useState<Lang>(studioLang());
  const [done, setDone] = useState<string[]>([]);
  const [copied, setCopied] = useState("");
  const seconds = useMemo(() => Math.round(compile(project).total * 10) / 10, [project]);
  const key = useMemo(() => keyMoveLabel(project), [project]);
  const hook = project.scenes[0]?.title ?? "";
  const kit = captionKit(lang, key, hook);
  const [lo, hi] = EDIT_TARGET_SECONDS;
  const long = seconds > hi + 2;
  const copyText = async (id: string, text: string) => {
    if (await copy(text)) {
      setCopied(id);
      window.setTimeout(() => setCopied(""), 1500);
    }
  };
  const musicOff = project.video.music === "none";

  return (
    <div class="studio-form edit-help">
      <div class="segmented studio-seg" role="group" aria-label={t("Sprache der Vorschläge")}>
        {(["de", "en"] as Lang[]).map((l) => (
          <button key={l} class={l === lang ? "active" : ""} aria-pressed={l === lang} onClick={() => setLang(l)}>
            {LANG_NAMES[l]}
          </button>
        ))}
      </div>

      <section class="edit-help-block">
        <h4>{t("Kürzer und dichter")}</h4>
        <p class="studio-hint">
          {t("Dein Edit ist {s} s lang, ideal sind {lo} bis {hi} s.", { s: seconds, lo, hi })} {long && <b class="bad">{t("Das ist lang für TikTok und Shorts.")}</b>}
        </p>
        <p class="studio-hint">{t("Die Funktion startet direkt in der kritischen Stellung (ohne Text, damit der Edit überall auf der Welt funktioniert), strafft die Schlagfolge zwischen Opfer und Matt auf etwa 4 Sekunden und macht den Abspann zu einem kurzen Overlay über dem zersplitterten Brett. Danach beginnt das Video von vorn.")}</p>
        <button
          class="btn primary"
          disabled={!canTighten(project)}
          onClick={() => {
            const r = tightenEdit(project, { lang });
            onProject(r.project);
            setDone(r.changes.length ? [...r.changes, t("Jetzt {s} Sekunden.", { s: Math.round(r.seconds * 10) / 10 })] : [t("Schon kurz und dicht, nichts zu ändern.")]);
          }}
        >
          {t("Edit straffen")}
        </button>
        {done.length > 0 && (
          <ul class="studio-hint">
            {done.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </section>

      <section class="edit-help-block">
        <h4>{t("Hook-Text oben im Rand")}</h4>
        <p class="studio-hint">{t("Ein Text in den ersten zwei Sekunden holt auch Zuschauer ab, die kaum Schach spielen. Ein Klick setzt ihn als Text der ersten Szene.")}</p>
        <ul class="edit-help-list">
          {[...hookStamps(lang).map((text) => ({ text, kind: "stamp" })), ...hookIdeas(lang)].map((h) => (
            <li key={h.text}>
              <span>{h.text}</span>
              <button class="btn ghost" onClick={() => onFirstTitle(h.text)} aria-pressed={hook === h.text}>
                {hook === h.text ? t("Gesetzt") : t("Als Hook")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section class="edit-help-block">
        <h4>{t("Caption und Kommentar-Frage")}</h4>
        <p class="studio-hint">{t("Eine konkrete Frage in der Caption oder als angepinnter Kommentar provoziert Antworten und Korrekturen.")}</p>
        <label class="studio-field">
          <textarea readOnly rows={6} value={kit.caption} />
        </label>
        <div class="edit-help-row">
          <button class="btn ghost" onClick={() => void copyText("caption", kit.caption)}>
            {copied === "caption" ? t("Kopiert") : t("Caption kopieren")}
          </button>
          <button class="btn ghost" onClick={() => void copyText("question", kit.question)}>
            {copied === "question" ? t("Kopiert") : t("Nur die Frage kopieren")}
          </button>
        </div>
      </section>

      <section class="edit-help-block">
        <h4>{t("Export und Reichweite")}</h4>
        <label class="studio-toggle">
          <input type="checkbox" checked={musicOff} onChange={() => onProject({ ...project, video: { ...project.video, music: musicOff ? "generated" : "none" } })} />
          <span class="studio-switch" aria-hidden="true" />
          <span>{t("Nur Effekt-Töne exportieren (Musik aus, für Trend-Audio)")}</span>
        </label>
        <ul class="edit-help-tips">
          {kit.tips.map((tip) => (
            <li key={tip.title}>
              <b>{tip.title}</b>
              <span class="studio-hint">{tip.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
