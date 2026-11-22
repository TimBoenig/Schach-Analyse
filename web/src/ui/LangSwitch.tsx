// Language choice. Each language is named in itself ("Deutsch", "English") so a
// visitor finds theirs even when the page is in the other one.
import { IconGlobe } from "./icons";
import { browserLang, changeLang, lang, LANG_NAMES, LANGS, langSetting, t, type Lang } from "../i18n";

/** Compact DE | EN toggle for the side bar and the landing page header. */
export function LangToggle({ class: cls = "" }: { class?: string }) {
  const now = lang();
  return (
    <div class={`lang-toggle ${cls}`} role="group" aria-label={t("Sprache")}>
      <IconGlobe />
      {LANGS.map((l) => (
        <button key={l} class={l === now ? "active" : ""} aria-pressed={l === now} lang={l} title={LANG_NAMES[l]} onClick={() => l !== now && changeLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Settings: automatic (browser language) or a fixed language. */
export function LangChoice() {
  const setting = langSetting();
  const detected: Lang = browserLang();
  const options: (Lang | "auto")[] = ["auto", ...LANGS];
  return (
    <div class="segmented lang-choice" role="radiogroup" aria-label={t("Sprache")}>
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={setting === o}
          class={setting === o ? "active" : ""}
          lang={o === "auto" ? undefined : o}
          onClick={() => setting !== o && changeLang(o)}
        >
          {o === "auto" ? t("Automatisch ({name})", { name: LANG_NAMES[detected] }) : LANG_NAMES[o]}
        </button>
      ))}
    </div>
  );
}
