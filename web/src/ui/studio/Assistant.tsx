// The studio's guided start: play the moves on a normal 2D board (side
// variations included), answer a few questions, optionally paste a script,
// and get a finished video project. Also hosts the move recorder that the
// editor uses to enter a scene's moves on the board.
import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "preact/hooks";

import { Board } from "../Board";
import { ENV_LABEL, germanSan, PLATFORM_LABEL, START_FEN, validFen, type Environment, type Platform, type StudioProject } from "./model";
import {
  buildProject,
  defaultAnswers,
  ENDING_LABEL,
  fenAt,
  hookIdeas,
  KIND_LABEL,
  playMove,
  takeBack,
  treeFromPgn,
  VIBE_LABEL,
  type Answers,
  type Cursor,
  type Ending,
  type GameTree,
  type Vibe,
  type VideoKind,
  suggestPerspective,
} from "./wizard";

// ---------- move recorder ----------

function moveName(tree: GameTree, line: number | "main", index: number, san: string): string {
  const base = line === "main" ? index : tree.variations[line].from + index;
  const startBlack = (tree.startFen.split(" ")[1] ?? "w") === "b";
  const fullmove = Number(tree.startFen.split(" ")[5]) || 1;
  const ply = base + (startBlack ? 1 : 0);
  const no = fullmove + Math.floor(ply / 2);
  const white = ply % 2 === 0;
  return white ? `${no}. ${germanSan(san)}` : index === 0 || line !== "main" ? `${no}… ${germanSan(san)}` : germanSan(san);
}

export function MoveRecorder({
  tree,
  cursor,
  onChange,
  keyMove = false,
  allowFen = true,
}: {
  tree: GameTree;
  cursor: Cursor;
  onChange: (tree: GameTree, cursor: Cursor) => void;
  /** Lets the user mark the key move (trap, puzzle solution). */
  keyMove?: boolean;
  allowFen?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const [pgnOpen, setPgnOpen] = useState(false);
  const [pgn, setPgn] = useState("");
  const [pgnError, setPgnError] = useState<string | null>(null);
  const [fenDraft, setFenDraft] = useState(tree.startFen === START_FEN ? "" : tree.startFen);
  const fen = useMemo(() => fenAt(tree, cursor), [tree, cursor]);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const last = useMemo(() => {
    if (cursor.ply === 0) return null;
    const before = new Chess(cursor.line === "main" ? fenAt(tree, { line: "main", ply: cursor.ply - 1 }) : fenAt(tree, { line: cursor.line, ply: cursor.ply - 1 }));
    const san = cursor.line === "main" ? tree.main[cursor.ply - 1] : tree.variations[cursor.line].moves[cursor.ply - 1];
    const m = before.move(san);
    return { from: m.from, to: m.to };
  }, [tree, cursor]);

  const onMove = (from: string, to: string, promotion?: string) => {
    const r = playMove(tree, cursor, { from, to, promotion });
    if (!r) return false;
    onChange(r.tree, r.cursor);
    return true;
  };
  const step = (d: number) => {
    const max = cursor.line === "main" ? tree.main.length : tree.variations[cursor.line].moves.length;
    const ply = Math.max(0, Math.min(max, cursor.ply + d));
    if (cursor.line !== "main" && ply === 0) onChange(tree, { line: "main", ply: tree.variations[cursor.line].from });
    else onChange(tree, { ...cursor, ply });
  };
  const loadPgn = () => {
    const r = treeFromPgn(pgn, tree.startFen);
    setPgnError(r.error ?? null);
    onChange(r.tree, { line: "main", ply: r.tree.main.length });
    if (!r.error) setPgnOpen(false);
  };
  const setStart = (value: string) => {
    setFenDraft(value);
    const f = value.trim() || START_FEN;
    if (validFen(f)) onChange({ startFen: f, main: [], variations: [], keyPly: -1 }, { line: "main", ply: 0 });
  };

  const onMain = cursor.line === "main";
  return (
    <div class="rec">
      <div class="rec-board">
        <Board
          fen={fen}
          flipped={flipped}
          lastMove={last}
          onMove={onMove}
          legalTargets={(from) => chess.moves({ square: from as Square, verbose: true }).map((m) => m.to)}
        />
        <div class="rec-nav">
          <button onClick={() => onChange(tree, { line: "main", ply: 0 })} title="Zum Anfang">
            ⏮
          </button>
          <button onClick={() => step(-1)} title="Zurück">
            ◀
          </button>
          <button onClick={() => step(1)} title="Vor">
            ▶
          </button>
          <button onClick={() => onChange(tree, { line: "main", ply: tree.main.length })} title="Zum Ende">
            ⏭
          </button>
          <button onClick={() => setFlipped(!flipped)} title="Brett drehen">
            ⇅
          </button>
          <button class="rec-undo" onClick={() => {
            const r = takeBack(tree, cursor);
            onChange(r.tree, r.cursor);
          }}>
            Zug löschen
          </button>
        </div>
      </div>
      <div class="rec-side">
        <p class="rec-hint">
          Zieh die Figuren. Gehst du zurück und spielst einen anderen Zug, entsteht automatisch eine <b>Variante</b>.
        </p>
        <div class="rec-line">
          <span class="rec-line-name">Hauptvariante</span>
          <div class="rec-moves">
            {tree.main.length === 0 && <span class="faint">Noch keine Züge</span>}
            {tree.main.map((san, i) => (
              <button
                key={i}
                class={`${onMain && cursor.ply === i + 1 ? "on" : ""} ${tree.keyPly === i ? "key" : ""}`}
                onClick={() => onChange(tree, { line: "main", ply: i + 1 })}
              >
                {moveName(tree, "main", i, san)}
              </button>
            ))}
          </div>
        </div>
        {tree.variations.map((v, vi) => (
          <div class="rec-line var" key={vi}>
            <span class="rec-line-name">Variante {vi + 1}</span>
            <div class="rec-moves">
              {v.moves.map((san, i) => (
                <button key={i} class={cursor.line === vi && cursor.ply === i + 1 ? "on" : ""} onClick={() => onChange(tree, { line: vi, ply: i + 1 })}>
                  {moveName(tree, vi, i, san)}
                </button>
              ))}
              <button class="rec-x" title="Variante löschen" onClick={() => onChange({ ...tree, variations: tree.variations.filter((_, k) => k !== vi) }, { line: "main", ply: v.from })}>
                ✕
              </button>
            </div>
          </div>
        ))}
        {keyMove && (
          <button
            class="btn ghost rec-key"
            disabled={!onMain || cursor.ply >= tree.main.length}
            onClick={() => onChange({ ...tree, keyPly: tree.keyPly === cursor.ply ? -1 : cursor.ply }, cursor)}
          >
            {tree.keyPly === cursor.ply && onMain ? "★ Schlüsselzug entfernen" : "★ Nächster Zug ist der Schlüsselzug"}
          </button>
        )}
        <details class="rec-more" open={pgnOpen} onToggle={(e) => setPgnOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>PGN oder Zugliste einfügen</summary>
          <textarea rows={3} value={pgn} onInput={(e) => setPgn(e.currentTarget.value)} placeholder="1. e4 e5 2. Sf3 Sc6 3. Lb5" spellcheck={false} />
          {pgnError && <p class="bad small">Ab „{pgnError}“ geht es nicht weiter.</p>}
          <button class="btn ghost" onClick={loadPgn}>
            Übernehmen
          </button>
        </details>
        {allowFen && (
          <details class="rec-more">
            <summary>Andere Startstellung (FEN)</summary>
            <input value={fenDraft} placeholder="Grundstellung" onInput={(e) => setStart(e.currentTarget.value)} spellcheck={false} />
            {fenDraft.trim() && !validFen(fenDraft.trim()) && <p class="bad small">Diese FEN ist ungültig.</p>}
          </details>
        )}
      </div>
    </div>
  );
}

// ---------- assistant ----------

const STEPS = ["Art", "Züge", "Fragen", "Skript"] as const;

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div class="wz-chips">
      {options.map(([v, l, hint]) => (
        <button key={String(v)} class={v === value ? "on" : ""} onClick={() => onChange(v)}>
          <b>{l}</b>
          {hint && <span>{hint}</span>}
        </button>
      ))}
    </div>
  );
}

const KIND_HINT: Record<VideoKind, string> = {
  opening: "Zug für Zug mit Ideen",
  trap: "Falle zeigen, Zuschauer raten lassen",
  puzzle: "Stellung, Countdown, Lösung",
  game: "Der beste Moment einer Partie",
};

export function Assistant({ onCreate, onClose, onTemplates, onAi }: { onCreate: (p: StudioProject) => void; onClose: () => void; onTemplates: () => void; onAi: () => void }) {
  const [stepIndex, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(defaultAnswers());
  const [tree, setTree] = useState<GameTree>(() => treeFromPgn("1. e4 e5 2. Sf3 Sc6 3. Lb5").tree);
  const [cursor, setCursor] = useState<Cursor>({ line: "main", ply: 5 });
  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }));
  const hooks = hookIdeas(answers.kind, answers.name, answers.length);
  const hook = answers.hook || hooks[0];
  const ready = tree.main.length > 0;

  const create = () => onCreate(buildProject(tree, { ...answers, hook }));
  const readFile = async (file: File) => set({ script: (await file.text()).slice(0, 20000) });

  return (
    <div class="studio-modal" role="dialog" aria-modal="true">
      <div class="studio-modal-card wizard">
        <header class="wz-head">
          <h3>Neues Video</h3>
          <ol class="wz-steps">
            {STEPS.map((s, i) => (
              <li key={s} class={i === stepIndex ? "on" : i < stepIndex ? "done" : ""}>
                <button onClick={() => (i <= stepIndex || ready) && setStep(i)}>
                  <span>{i + 1}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
          <button class="wz-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </header>

        <div class="wz-body">
          {stepIndex === 0 && (
            <div class="studio-form">
              <h4 class="wz-q">Was für ein Video wird es?</h4>
              <Chips<VideoKind>
                value={answers.kind}
                options={(Object.keys(KIND_LABEL) as VideoKind[]).map((k) => [k, KIND_LABEL[k], KIND_HINT[k]])}
                onChange={(kind) => set({ ...defaultAnswers(kind), platform: answers.platform, name: answers.name })}
              />
              <h4 class="wz-q">Wo lädst du es hoch?</h4>
              <Chips<Platform> value={answers.platform} options={(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => [p, PLATFORM_LABEL[p]])} onChange={(platform) => set({ platform })} />
              <h4 class="wz-q">Worum geht es? (Name der Eröffnung, Falle, Partie)</h4>
              <input class="wz-input" value={answers.name} onInput={(e) => set({ name: e.currentTarget.value, hook: "" })} placeholder="z. B. Spanische Eröffnung" />
              <p class="studio-hint">
                Lieber ohne Assistent? <button class="studio-link" onClick={onAi}>Von einer KI schreiben lassen</button> oder <button class="studio-link" onClick={onTemplates}>Fertige Vorlage öffnen</button>
              </p>
            </div>
          )}

          {stepIndex === 1 && (
            <>
              <p class="wz-lead">
                {answers.kind === "puzzle"
                  ? "Spiel die Züge bis zur Rätselstellung, dann die Lösung. Markier den ersten Zug der Lösung als Schlüsselzug."
                  : answers.kind === "trap"
                    ? "Spiel die Falle vor und markier den entscheidenden Zug als Schlüsselzug: davor dürfen die Zuschauer raten."
                    : "Spiel die Züge vor. Pfeile und Erklärungen entstehen danach automatisch."}
              </p>
              <MoveRecorder
                tree={tree}
                cursor={cursor}
                keyMove={answers.kind !== "opening"}
                onChange={(tk, c) => {
                  setTree(tk);
                  setCursor(c);
                }}
              />
            </>
          )}

          {stepIndex === 2 && (
            <div class="studio-form">
              <h4 class="wz-q">Wie lang soll das Video werden?</h4>
              <Chips<Answers["length"]> value={answers.length} options={[[15, "15 s"], [30, "30 s"], [45, "45 s"], [60, "60 s"]]} onChange={(length) => set({ length })} />
              <h4 class="wz-q">Welcher Stil?</h4>
              <Chips<Vibe>
                value={answers.vibe}
                options={[
                  ["viral", VIBE_LABEL.viral, "schnelle Schnitte, Neon"],
                  ["calm", VIBE_LABEL.calm, "Zeit zum Mitdenken"],
                  ["elegant", VIBE_LABEL.elegant, "Holz, Serifenschrift"],
                ]}
                onChange={(vibe) => set({ vibe, environment: vibe === "viral" ? "neon" : vibe === "calm" ? "podium" : "library" })}
              />
              <h4 class="wz-q">Für wen?</h4>
              <Chips<Answers["level"]>
                value={answers.level}
                options={[
                  ["beginner", "Einsteiger"],
                  ["advanced", "Fortgeschrittene"],
                ]}
                onChange={(level) => set({ level })}
              />
              <h4 class="wz-q">Erster Satz (der Hook)</h4>
              <div class="wz-hooks">
                {hooks.map((h) => (
                  <button key={h} class={hook === h ? "on" : ""} onClick={() => set({ hook: h })}>
                    {h}
                  </button>
                ))}
              </div>
              <input class="wz-input" value={hook} onInput={(e) => set({ hook: e.currentTarget.value })} />
              <label class="studio-toggle">
                <input type="checkbox" checked={answers.poll} onChange={() => set({ poll: !answers.poll })} />
                <span class="studio-switch" aria-hidden="true" />
                <span>Zuschauer vor dem Schlüsselzug raten lassen (Umfrage A/B/C)</span>
              </label>
              {answers.poll && tree.keyPly < 0 && answers.kind !== "puzzle" && <p class="studio-hint">Markier dafür im Schritt „Züge“ einen Schlüsselzug.</p>}
              <h4 class="wz-q">Wie soll es enden?</h4>
              <Chips<Ending> value={answers.ending} options={(Object.keys(ENDING_LABEL) as Ending[]).map((e) => [e, ENDING_LABEL[e]])} onChange={(ending) => set({ ending })} />
              <h4 class="wz-q">Aus wessen Sicht schaut man aufs Brett?</h4>
              <Chips<Answers["perspective"]>
                value={answers.perspective}
                options={[
                  ["auto", "Automatisch", tree.keyPly >= 0 ? `wer den Schlüsselzug spielt: ${suggestPerspective(tree) === "white" ? "Weiß" : "Schwarz"}` : "Weiß"],
                  ["white", "Weiß", "Weiß unten"],
                  ["black", "Schwarz", "Schwarz unten, z. B. für Sizilianisch"],
                ]}
                onChange={(perspective) => set({ perspective })}
              />
              <h4 class="wz-q">Wo steht das Brett?</h4>
              <Chips<Environment> value={answers.environment} options={(Object.keys(ENV_LABEL) as Environment[]).map((e) => [e, ENV_LABEL[e]])} onChange={(environment) => set({ environment })} />
            </div>
          )}

          {stepIndex === 3 && (
            <div class="studio-form">
              <p class="wz-lead">
                Hast du schon ein Skript? Füg es ein: Sätze, die einen Zug nennen (z. B. „Mit Lb5 …“), landen genau bei diesem Zug, der Rest verteilt sich der Reihe nach. Ohne Skript schreibt das Studio
                kurze Erklärungen selbst.
              </p>
              <textarea class="wz-script" rows={9} value={answers.script} onInput={(e) => set({ script: e.currentTarget.value })} placeholder={"Heute lernst du die Spanische Eröffnung.\nNach e4 und e5 kämpfen beide ums Zentrum.\nMit Lb5 greift Weiß den Verteidiger von e5 an.\nFolge für Teil zwei!"} />
              <label class="btn ghost wz-file">
                Textdatei hochladen
                <input type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => e.currentTarget.files?.[0] && void readFile(e.currentTarget.files[0])} />
              </label>
            </div>
          )}
        </div>

        <footer class="wz-foot">
          {stepIndex > 0 && (
            <button class="btn ghost" onClick={() => setStep(stepIndex - 1)}>
              Zurück
            </button>
          )}
          <span class="wz-summary">
            {tree.main.length} Züge{tree.variations.length ? `, ${tree.variations.length} Variante${tree.variations.length > 1 ? "n" : ""}` : ""} · {PLATFORM_LABEL[answers.platform]} · {answers.length} s
          </span>
          {stepIndex < STEPS.length - 1 ? (
            <button class="btn primary" disabled={stepIndex === 1 && !ready} onClick={() => setStep(stepIndex + 1)}>
              Weiter
            </button>
          ) : null}
          <button class={`btn ${stepIndex === STEPS.length - 1 ? "primary" : "ghost"}`} disabled={!ready} onClick={create}>
            Video erstellen
          </button>
        </footer>
      </div>
    </div>
  );
}
