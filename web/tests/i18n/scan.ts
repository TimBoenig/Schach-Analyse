// Source scanner for the i18n checks: finds every text passed to t()/tr() and
// German text that is not passed through the dictionary.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

import { EN } from "../../src/i18n/en";

export const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

export interface Hit {
  file: string;
  line: number;
  text: string;
}

export interface Scan {
  /** Literal texts passed to t() or as the 2nd argument of tr(). */
  keys: Hit[];
  /** Every other string literal and template literal (templates with "{}" for the gaps). */
  literals: Set<string>;
  /** German-looking texts outside t(): JSX text and string literals. */
  german: Hit[];
}

// A text looks German when it has German letters or a word that occurs in the
// German texts of the dictionary but in none of the English ones.
const words = (s: string) => s.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
const english = new Set(Object.values(EN).flatMap(words));
const germanWords = new Set(Object.keys(EN).flatMap(words).filter((w) => !english.has(w)));
const GERMAN = { test: (s: string) => /[äöüÄÖÜß]/.test(s) || words(s).some((w) => germanWords.has(w)) };
const CODE = /^[\w.\-/:#?=&%@$*+{}]+$/;
// Code, not text: identifiers, paths, CSS class lists, shader sources.
// A single word that is German ("besser", "heute") is text, not an identifier.
const isCode = (s: string) => (CODE.test(s) && !(/^\p{L}+$/u.test(s) && GERMAN.test(s))) || /^\s*precision /.test(s) || /^[a-z0-9{}]+(-[a-z0-9{}]+)*( [a-z0-9{}]+(-[a-z0-9{}]+)*)*$/.test(s) && /-/.test(s);

/** JSX words that read the same in both languages. */
const TECH = /^(MB|Esc|OK|PGN|FEN|Auto|Elo|fps|s|px|Bullet|Blitz|Rapid|Lichess|chess\.com)$/;

/** Files that are made of identifiers (route slugs, import aliases of the video-script format), not of texts. */
const ID_FILES = ["ui/router.ts", "ui/Layout.tsx", "ui/StatsLayout.tsx", "ui/LandingView.tsx", "ui/stage/script.ts", "ui/studio/aiScript.ts"];
/** Single German words that are stored ids: they are shown through t() where they are shown at all. */
const ID_WORDS = /^(pos|ich|lang|hoch|mittel|niedrig|klar|deutlich|knapp|Strategie|Taktik|Psychologie|Zeit|Wertung|Ergebnisse|vereinsniveau|szene|stil|holz|schiefer|entwicklung|blick|ergebnisse|verlauf|gewohnheiten|duelle|liga|rekorde|rangliste|spieler|heute|fortschritt|daten|impressum|der|die)$/;

/** Files whose texts are stored in German on purpose (translated on display via tStored). */
export const STORED_GERMAN = ["domain/classifier.ts", "domain/termination.ts", "i18n/", "domain/metrics/termination.ts"];

function textOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function templateShape(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map((s) => "{}" + s.literal.text).join("");
}

export function scan(): Scan {
  const keys: Hit[] = [];
  const literals = new Set<string>();
  const german: Hit[] = [];
  for (const path of walk(SRC)) {
    const file = relative(SRC, path).replace(/\\/g, "/");
    if (file.startsWith("i18n/")) continue;
    const code = readFileSync(path, "utf8");
    const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const stored = STORED_GERMAN.some((s) => file.startsWith(s));
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const keyArgs = new Set<ts.Node>();
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const arg = name === "t" || name === "tj" ? node.arguments[0] : name === "tr" ? node.arguments[1] : undefined;
        if (arg) {
          const tx = textOf(arg);
          if (tx !== null) keys.push({ file, line: lineOf(arg), text: tx });
          keyArgs.add(arg);
        }
      }
      if (!keyArgs.has(node)) {
        const tx = textOf(node);
        if (tx !== null) literals.add(tx);
        if (ts.isTemplateExpression(node)) literals.add(templateShape(node));
        if (!stored && tx !== null && GERMAN.test(tx) && !isCode(tx) && !isIgnoredContext(node) && !ID_FILES.includes(file) && !ID_WORDS.test(tx)) german.push({ file, line: lineOf(node), text: tx });
        if (!stored && ts.isTemplateExpression(node)) {
          const shape = templateShape(node);
          if (GERMAN.test(shape.replace(/\{\}/g, " ")) && !isCode(shape) && !isIgnoredContext(node)) german.push({ file, line: lineOf(node), text: shape });
        }
      }
      if (ts.isJsxText(node)) {
        const tx = node.text.replace(/\s+/g, " ").trim();
        if (tx && /\p{L}{2,}/u.test(tx) && !TECH.test(tx)) german.push({ file, line: lineOf(node), text: tx });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { keys, literals, german };
}

/** Literals that are never shown: imports, comparisons with stored ids, storage keys, console output. */
function isIgnoredContext(node: ts.Node): boolean {
  // "// i18n: ..." on the line or the line above marks German on purpose (grammar helpers).
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
  const lines = sf.text.split("\n");
  if (/\/\/ i18n:/.test(lines[line] ?? "") || /\/\/ i18n:/.test(lines[line - 1] ?? "")) return true;
  let p = node.parent;
  if (!p) return false;
  // a ? "x" : "y" counts like its parent
  while (p.parent && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true; // type unions of ids
  if ((ts.isPropertyAssignment(p) || ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && (p as ts.PropertyAssignment).name === node) return true; // keys
  if (ts.isJsxAttribute(p) && /^(class|className|key|id|href|src|type|role|style|for|name|value|inputMode|autocomplete|download)$/.test(p.name.getText())) return true;
  if (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) && /^(class|className|key|id|href|src|style|download)$/.test(p.parent.name.getText())) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
    const m = p.expression.name.text;
    if (/^(error|warn|log|info|debug|includes|startsWith|endsWith|test|getItem|setItem|removeItem)$/.test(m)) return true;
  }
  if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^(tStored|describe|it|test|art)$/.test(p.expression.text)) return true;
  return false;
}
