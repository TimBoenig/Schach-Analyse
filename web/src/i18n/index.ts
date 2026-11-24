// Site language. German is the source language: every text is written in German
// in the code and wrapped in t(), and en.ts maps those German texts to English.
// One dictionary, one lookup; tests/i18n flags German texts without an English
// entry and German literals that are not wrapped at all.
//
// The language is fixed for the lifetime of a page: switching saves the choice
// and reloads. Module-level label tables are built with t() at import time, so a
// reload is the only way every one of them is rebuilt in the new language.

export type Lang = "de" | "en";
export const LANGS: readonly Lang[] = ["de", "en"];
export const LANG_NAMES: Record<Lang, string> = { de: "Deutsch", en: "English" };

/** Chosen site language (absent = follow the browser). */
export const LANG_KEY = "schach.lang";
/** Language of the video studio: "auto" follows the site. */
export const STUDIO_LANG_KEY = "schach.studio.lang";
export type StudioLang = Lang | "auto";

let current: Lang = "de";
let dict: Record<string, string> | null = null;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode)
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
};
const isLang = (v: unknown): v is Lang => v === "de" || v === "en";

/** The browser's preferred language among ours: first de-* or en-* entry, else English. */
export function browserLang(langs?: readonly string[]): Lang {
  const list =
    langs ?? (typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const l of list) {
    const p = String(l ?? "")
      .toLowerCase()
      .slice(0, 2);
    if (p === "de" || p === "en") return p;
  }
  // Neither German nor English: English reaches more visitors.
  return "en";
}

/** Site language: the saved choice, else the browser's. */
export function siteLang(): Lang {
  const saved = read(LANG_KEY);
  return isLang(saved) ? saved : browserLang();
}

/** The studio's own setting ("auto" = same as the site). */
export function studioSetting(): StudioLang {
  const saved = read(STUDIO_LANG_KEY);
  return isLang(saved) ? saved : "auto";
}
export function studioLang(): Lang {
  const s = studioSetting();
  return s === "auto" ? siteLang() : s;
}

/** Language a page needs: the studio has its own, everything else uses the site's. */
export function pageLang(view: string): Lang {
  return view === "studio" ? studioLang() : siteLang();
}

/** Loads the English dictionary (a separate chunk, so German pages never fetch it). */
export async function loadDict(): Promise<void> {
  if (!dict) dict = (await import("./en")).EN;
}

/** Sets the language of this page; call before the views are imported. */
export async function initLang(l: Lang): Promise<void> {
  if (l === "en") await loadDict();
  current = l;
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

/** Synchronous variant for workers and tests that already hold the dictionary. */
export function setLangNow(l: Lang, d?: Record<string, string>): void {
  if (d) dict = d;
  current = l;
}

export const lang = (): Lang => current;

/** The saved site choice ("auto" = follow the browser). */
export function langSetting(): Lang | "auto" {
  const saved = read(LANG_KEY);
  return isLang(saved) ? saved : "auto";
}

/** Saves the site language ("auto" follows the browser) and reloads, so every label is rebuilt in it. */
export function changeLang(l: Lang | "auto"): void {
  write(LANG_KEY, l === "auto" ? null : l);
  if (typeof location !== "undefined") location.reload();
}

/** Saves the studio language ("auto" follows the site) and reloads. */
export function changeStudioLang(l: StudioLang): void {
  write(STUDIO_LANG_KEY, l === "auto" ? null : l);
  if (typeof location !== "undefined") location.reload();
}

const fill = (s: string, params?: Record<string, unknown>): string =>
  params
    ? s.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k: string) => {
        if (!(k in params)) return m;
        const v = params[k];
        // `cond && t(...)` passes false when the part is left out.
        return v === null || v === undefined || v === false ? "" : String(v);
      })
    : s;

/** Text in a given language; `de` is the German source text, `{name}` are filled from params. */
export function tr(l: Lang, de: string, params?: Record<string, unknown>): string {
  return fill(l === "en" ? (dict?.[de] ?? de) : de, params);
}

/** Text in the page's language. */
/** Capital first letter, for a word that starts a label (German nouns already have one). */
export const cap = (s: string): string => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1);

export function t(de: string, params?: Record<string, unknown>): string {
  return tr(current, de, params);
}

/**
 * Text with inline elements: like t(), but the placeholders may be JSX nodes
 * (a bold number, a link). Returns the pieces for a JSX child list, so a whole
 * sentence is translated at once instead of in word-order-dependent fragments.
 */
export function tj<T>(de: string, parts: Record<string, T | string | number | null | undefined>): (T | string)[] {
  const text = current === "en" ? (dict?.[de] ?? de) : de;
  const out: (T | string)[] = [];
  for (const piece of text.split(/(\{[A-Za-z0-9_]+\})/)) {
    const m = /^\{([A-Za-z0-9_]+)\}$/.exec(piece);
    if (m && m[1] in parts) {
      const v = parts[m[1]];
      if (v !== null && v !== undefined && v !== "") out.push(typeof v === "number" ? String(v) : (v as T | string));
    } else if (piece) out.push(piece);
  }
  return out;
}

/** Locale for dates and numbers. */
export const locale = (): string => (current === "en" ? "en-US" : "de-DE");
/** Decimal separator of the page's language. */
export const dec = (): string => (current === "en" ? "." : ",");

// ---------- texts stored in German ----------
// Move explanations and game endings are saved with the games (and synced), so
// they are always written in German and translated when shown. Those texts are
// built from dictionary templates, so a stored sentence is matched back to its
// template and the filled-in parts are translated the same way.

let templates: { re: RegExp; names: string[]; en: string }[] | null = null;

function buildTemplates() {
  const list: { re: RegExp; names: string[]; en: string }[] = [];
  for (const [de, en] of Object.entries(dict ?? {})) {
    if (!de.includes("{")) continue;
    const names: string[] = [];
    const src = de
      .split(/(\{[A-Za-z0-9_]+\})/)
      .map((part) => {
        const m = /^\{([A-Za-z0-9_]+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(m[1]);
        return "(.+?)";
      })
      .join("");
    if (!names.length) continue;
    list.push({ re: new RegExp(`^${src}$`, "s"), names, en });
  }
  // Longer templates first: they are more specific.
  list.sort((a, b) => b.re.source.length - a.re.source.length);
  return list;
}

function translateStored(s: string, depth: number): string {
  const d = dict;
  if (!d || !s) return s;
  const exact = d[s];
  if (exact !== undefined) return exact;
  if (depth > 2) return s;
  templates ??= buildTemplates();
  for (const tpl of templates) {
    const m = tpl.re.exec(s);
    if (!m) continue;
    const params: Record<string, string> = {};
    tpl.names.forEach((n, i) => (params[n] = translateStored(m[i + 1], depth + 1)));
    return fill(tpl.en, params);
  }
  return s;
}

/** Shows a stored German text in the page's language (sentence by sentence). */
export function tStored(s: string | null | undefined): string {
  if (!s) return "";
  if (current !== "en" || !dict) return s;
  const whole = translateStored(s, 0);
  if (whole !== s) return whole;
  return s
    .split(/(?<=[.!?])\s+/)
    .map((part) => translateStored(part, 0))
    .join(" ");
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** Short axis label of a day: "22.11." in German, "11/22" in English. */
export const dayMonthLabel = (d: Date, pad = true): string =>
  current === "en" ? `${d.getMonth() + 1}/${pad ? p2(d.getDate()) : d.getDate()}` : `${pad ? p2(d.getDate()) : d.getDate()}.${p2(d.getMonth() + 1)}.`;
/** Short axis label of a month: "11.26" in German, "11/26" in English. */
export const monthYearLabel = (d: Date): string => `${p2(d.getMonth() + 1)}${current === "en" ? "/" : "."}${String(d.getFullYear()).slice(2)}`;
