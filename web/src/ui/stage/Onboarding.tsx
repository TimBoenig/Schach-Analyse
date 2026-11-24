// The first start, fullscreen with Lucena: who she is, where the user plays,
// their games arriving live, the engine starting, then a walk through the
// four areas. Everything she says about the user is counted from the games
// that were just imported.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { autoAnalyze, subscribeQueue, type QueueState } from "../../app/analysisService";
import { importAccount, type Site } from "../../app/accountImport";
import { BRAND } from "../../brand";
import { type FirstFinding, firstFinding, firstThoughts } from "../../domain/firstInsights";
import { type FirstLook, firstLook } from "../../domain/firstLook";
import { type BatchProgress, batchProgress } from "../../domain/firstPass";
import type { GameAnalysis } from "../../domain/types";
import { getSetting, listGames } from "../../storage/db";
import { fromStoredGame } from "../../storage/rows";
import type { Mood } from "../Coach";
import { IconBolt, IconChevron, IconCpu, IconGames, IconInsights, IconTraining, IconUpload } from "../icons";
import { CountUp } from "../kit";
import { navigate } from "../router";
import { Illus } from "./Illus";
import { backStep, canAdvance, type ImportPhase, onboardPath, onboardPhases, type SitePick, tourStop } from "./script";
import { Stage, StagePoint } from "./Stage";
import { markSeen } from "./store";
import { t, tj, locale } from "../../i18n";

const SITE_LABEL: Record<Site, string> = { chesscom: "chess.com", lichess: "Lichess" };

const SITES: { key: SitePick; label: string; sub: string; mark: string }[] = [
  { key: "chesscom", label: "chess.com", sub: t("Ich hole deine Partien der letzten drei Monate."), mark: "C" },
  { key: "lichess", label: "Lichess", sub: t("Ich hole deine letzten 100 Partien."), mark: "L" },
  { key: "none", label: t("Noch nirgends"), sub: t("Oder ich habe meine Partien als PGN-Datei."), mark: "?" },
];

type Load = { phase: "idle" } | { phase: "busy"; label: string; found: number } | { phase: "done"; look: FirstLook; queued: boolean } | { phase: "empty" } | { phase: "error"; message: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString(locale())} ${n === 1 ? one : many}`;

function useQueue(): QueueState | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/**
 * The engine's quick first pass as numbers. It counts as done once the queue
 * has left the quick pass (the deeper pass follows, or nothing is left), and
 * stays done from then on.
 */
function useFirstPass(): { p: BatchProgress | null; done: boolean; finished: number } {
  const q = useQueue();
  const quick = q?.pass === "quick";
  const p = q && quick ? batchProgress({ finished: q.finished, current: q.current, queued: q.queued.length, done: q.done, total: q.total, deeper: q.deeper }) : null;
  const [done, setDone] = useState(false);
  const ran = useRef(false);
  if (quick) ran.current = true;
  useEffect(() => {
    if (!done && ran.current && q && !quick) setDone(true);
  });
  return { p, done, finished: q?.finished ?? 0 };
}

const THOUGHT_MS = 4200;

/** "Lucena denkt …": facts from the games that are already in, one at a time. */
function Thoughts({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = window.setInterval(() => setI((v) => v + 1), THOUGHT_MS);
    return () => window.clearInterval(t);
  }, [lines.length]);
  if (!lines.length) return null;
  const k = i % lines.length;
  return (
    <div class="stage-thought" aria-live="polite">
      <span class="stage-thought-head">
        {tj("{x}Lucena denkt …", { x: <span class="stage-thought-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span> })}
      </span>
      <p key={k}>{lines[k]}</p>
    </div>
  );
}

/** Live state of the engine's first pass over the imported games. */
function AnalysisPanel({ p, done }: { p: BatchProgress | null; done: boolean }) {
  const running = Boolean(p && !p.idle && !done);
  const pct = done ? 100 : p ? Math.round(p.fraction * 100) : 0;
  return (
    <div class="stage-panel">
      <div class="stage-row">
        <strong>{done ? t("Erste Runde fertig") : running ? t("Partie {index} von {games}", { index: p!.index, games: p!.games }) : t("Die Engine startet …")}</strong>
        <span class="faint tnum">{running ? `${pct} %` : ""}</span>
      </div>
      <div class={`stage-meter${running || done ? "" : " busy"}`} style={{ marginTop: "12px" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Fortschritt der Analyse")}>
        <span style={running || done ? { width: `${Math.max(3, pct)}%` } : undefined} />
      </div>
    </div>
  );
}

/** Reads the imported games again whenever the engine finishes one, for the first finding. */
function useFinding(ids: string[], name: string, finished: number): FirstFinding | null {
  const [finding, setFinding] = useState<FirstFinding | null>(null);
  useEffect(() => {
    if (!ids.length) return;
    let alive = true;
    const wanted = new Set(ids);
    void listGames()
      .then((rows) => {
        const games: GameAnalysis[] = rows.filter((r) => wanted.has(r.id)).map(fromStoredGame);
        if (alive) setFinding(firstFinding(games, name));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ids, name, finished]);
  return finding;
}

const pct = (v: number) => `${v} %`;

/**
 * The first real result: what the engine found so far, and the one move that
 * cost the most. Shown while the analysis runs and as the end of the start.
 */
function FindingCard({ f, onOpen }: { f: FirstFinding; onOpen: (gameId: string, ply: number) => void }) {
  const c = f.costliest;
  return (
    <div class="stage-finding">
      <div class="stage-finding-head">
        <IconInsights />
        <span>{t("Erster Befund aus {n}", { n: plural(f.analysed, t("Partie"), t("Partien")) })}</span>
      </div>
      <div class="stage-stats">
        <div class="stage-stat bad">
          <b>
            <CountUp value={f.blunders} />
          </b>
          <span>{t("Patzer")}</span>
        </div>
        <div class="stage-stat">
          <b>
            <CountUp value={f.mistakes} />
          </b>
          <span>{t("Fehler")}</span>
        </div>
        <div class="stage-stat good">
          <b>{f.bestGame ? <CountUp value={f.bestGame.accuracy} format={(v) => pct(Math.round(v))} /> : "–"}</b>
          <span>{t("beste Genauigkeit")}</span>
        </div>
      </div>
      {c && (
        <div class="stage-costly">
          <p>
            {c.why.length
              ? tj("{label} {move} {san} gegen {opponent}. {why}", { label: <b>{t("Dein teuerster Zug:")}</b>, move: `${c.moveNumber}${c.white ? "." : "..."}`, san: c.san, opponent: c.opponent, why: c.why.join(" ") })
              : tj("{label} {move} {san} gegen {opponent}. Deine Gewinnchance fiel von {before} auf {after}.{better}", { label: <b>{t("Dein teuerster Zug:")}</b>, move: `${c.moveNumber}${c.white ? "." : "..."}`, san: c.san, opponent: c.opponent, before: pct(c.before), after: pct(c.after), better: c.better ? t(" Besser war {better}.", { better: c.better }) : "" })}
          </p>
          <button class="btn" onClick={() => onOpen(c.gameId, c.ply)}>
            
            {t("Diese Stelle ansehen")}
            <IconChevron />
          </button>
        </div>
      )}
    </div>
  );
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [pick, setPick] = useState<SitePick | null>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [load, setLoad] = useState<Load>({ phase: "idle" });
  // What Lucena can already say while games arrive, and the ids for her first finding.
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const { p: pass, done: passDone, finished } = useFirstPass();
  const finding = useFinding(ids, name.trim(), finished);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const path = useMemo(() => onboardPath(pick), [pick]);
  const step = path[Math.min(index, path.length - 1)];
  const phase: ImportPhase = load.phase;

  // A name the import dialog used before is offered again, for the site picked:
  // a Lichess name sent to chess.com was stored as the chess.com name from then on.
  useEffect(() => {
    if (pick !== "chesscom" && pick !== "lichess") return;
    void getSetting<Record<string, string>>("import.lastUser", {}).then((u) => {
      if (!alive.current) return;
      const remembered = new Set(Object.values(u).map((v) => v.trim()));
      setName((n) => (!n.trim() || remembered.has(n.trim()) ? (u[pick] ?? "") : n));
    });
  }, [pick]);
  useEffect(() => {
    if (step === "name") window.setTimeout(() => input.current?.focus({ preventScroll: true }), 420);
    // A page this walk introduced does not open its own guide by itself later.
    const shown = tourStop(step);
    if (shown) markSeen(`page:${shown.guide}`);
  }, [step]);

  const finish = (to?: () => void) => {
    markSeen("onboarding");
    onClose();
    to?.();
  };

  const fetchGames = async () => {
    if (pick !== "chesscom" && pick !== "lichess") return;
    const who = name.trim();
    if (!who) return;
    setIndex(path.indexOf("import"));
    setLoad({ phase: "busy", label: t("Ich suche dein Konto …"), found: 0 });
    let found = 0;
    const arrived: GameAnalysis[] = [];
    try {
      const { games } = await importAccount(pick, who, {
        months: 3,
        count: 100,
        onProgress: (label) => alive.current && setLoad({ phase: "busy", label, found }),
        onStored: (batch) => {
          found += batch.length;
          arrived.push(...batch);
          if (!alive.current) return;
          setLoad((l) => (l.phase === "busy" ? { ...l, found } : l));
          setThoughts(firstThoughts(arrived, who));
        },
      });
      const look = firstLook(games, who);
      setThoughts(firstThoughts(games, who));
      setIds(games.map((g) => g.game_id));
      if (!look.games) {
        if (alive.current) setLoad({ phase: "empty" });
        return;
      }
      const queued = await autoAnalyze(games.map((g) => g.game_id), { quick: true }).catch(() => false);
      if (alive.current) setLoad({ phase: "done", look, queued });
    } catch (e) {
      if (alive.current) setLoad({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const ok = canAdvance(step, { pick, name, phase });
  const next = () => {
    if (!ok) return;
    if (step === "name") return void fetchGames();
    if (step === "ready") return finish(() => navigate({ view: "home" }));
    setIndex((i) => Math.min(i + 1, path.length - 1));
  };
  const backTo = backStep(path, index, phase);
  const back = backTo === null ? undefined : () => setIndex(backTo);
  const retryName = () => {
    setLoad({ phase: "idle" });
    setIndex(path.indexOf("name"));
  };

  const phases = onboardPhases(path, index, {
    phase,
    found: load.phase === "busy" ? load.found : load.phase === "done" ? load.look.games : 0,
    pass,
    passDone,
  });
  const common = {
    phases: phases.list,
    phase: phases.at,
    steps: path.length,
    step: index,
    stepKey: step,
    onBack: back,
    onNext: next,
    onClose: () => finish(),
  };
  const openSpot = (gameId: string, ply: number) => finish(() => navigate({ view: "analysis", gameId, ply }));
  const nextButton = (label: string, disabled = false) => (
    <button class="btn primary" onClick={next} disabled={disabled}>
      {label}
      <IconChevron />
    </button>
  );

  if (step === "hello") {
    return (
      <Stage
        {...common}
        layout="center"
        mood="happy"
        say={t("Hi, ich bin Lucena.")}
        sub={
          <p>
            
            {t("Ich lese deine Partien, finde heraus, wo du wirklich Punkte liegen lässt, und baue dir daraus ein Training. In zwei Minuten zeige ich dir alles.")}
          </p>
        }
        closeLabel={t("Ich kenne mich aus")}
        actions={
          <>
            <span class="stage-hint">
              
              {tj("Weiter mit {x}", { x: <kbd>{t("Enter")}</kbd> })}
            </span>
            {nextButton(t("Los geht's"))}
          </>
        }
      />
    );
  }

  if (step === "site") {
    return (
      <Stage {...common} mood={pick ? "wow" : "think"} say={t("Wo spielst du Schach?")} sub={<p>{t("Ich hole nur deine öffentlichen Partien. Sie bleiben auf deinem Gerät.")}</p>} actions={nextButton(t("Weiter"), !ok)}>
        <div class="stage-choices" role="group" aria-label={t("Wo spielst du?")}>
          {SITES.map((s) => (
            <button
              key={s.key}
              class="stage-choice"
              aria-pressed={pick === s.key}
              onClick={() => {
                setPick(s.key);
                setLoad({ phase: "idle" });
                // The path depends on the choice; "site" is always its second step.
                window.setTimeout(() => alive.current && setIndex(2), 320);
              }}
            >
              <span class="stage-choice-icon">{s.mark}</span>
              <span class="stage-choice-text">
                {s.label}
                <small>{s.sub}</small>
              </span>
              <IconChevron />
            </button>
          ))}
        </div>
      </Stage>
    );
  }

  if (step === "nosite") {
    return (
      <Stage
        {...common}
        mood="happy"
        say={t("Kein Problem, wir fangen trotzdem an.")}
        sub={<p>{t("Sobald du online spielst, holst du deine Partien mit einem Tipp. Hast du Partien als PGN-Datei, lade sie gleich hoch.")}</p>}
        actions={
          <>
            <button class="btn" onClick={() => finish(() => navigate({ view: "games", import: true }))}>
              <IconUpload />
              
              {t("PGN-Datei laden")}
            </button>
            {nextButton(t("Zeig mir die App"))}
          </>
        }
      >
        <Illus kind="engine" />
      </Stage>
    );
  }

  if (step === "name") {
    const site = SITE_LABEL[pick as Site];
    return (
      <Stage {...common} mood={name.trim() ? "happy" : "think"} say={t("Wie heißt du bei {site}?", { site })} sub={<p>{t("Dein Benutzername reicht, kein Passwort. Ein Konto bei {BRAND} brauchst du nicht.", { BRAND })}</p>} actions={nextButton(t("Partien holen"), !ok)}>
        <form
          class="stage-field"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <input
            ref={input}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder={t("Dein Benutzername")}
            autocomplete="username"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="go"
            aria-label={t("Benutzername bei {site}", { site })}
          />
        </form>
        <p class="stage-note">{t("Ich lese nur, was bei {site} öffentlich zu sehen ist.", { site })}</p>
      </Stage>
    );
  }

  if (step === "import") {
    const site = SITE_LABEL[pick as Site];
    const failed = load.phase === "error" || load.phase === "empty";
    const look = load.phase === "done" ? load.look : null;
    const mood: Mood = failed ? "sad" : look ? "wow" : "think";
    const say = load.phase === "error" ? t("Das hat nicht geklappt.") : load.phase === "empty" ? t("Ich habe keine Partien gefunden.") : look ? t("{n} sind da.", { n: plural(look.games, t("Partie"), t("Partien")) }) : t("Ich hole deine Partien …");
    const sub =
      load.phase === "error" ? (
        <p>{load.message}</p>
      ) : load.phase === "empty" ? (
        <p>
          
          {t("Unter „{n}“ gibt es bei {site} in den letzten Monaten keine Partien. Stimmt der Name?", { n: name.trim(), site })}
        </p>
      ) : look ? (
        <p>{t("Das ist deine Bilanz, bevor die Engine einen einzigen Zug gesehen hat.")}</p>
      ) : (
        <p>{load.phase === "busy" ? load.label : ""}</p>
      );
    return (
      <Stage
        {...common}
        mood={mood}
        say={say}
        sub={sub}
        actions={
          failed ? (
            <button class="btn primary" onClick={retryName}>
              
              {t("Namen ändern")}
            </button>
          ) : (
            nextButton(t("Weiter"), !ok)
          )
        }
      >
        {load.phase === "busy" && (
          <div class="stage-panel">
            <div class="stage-row">
              <strong>
                <CountUp value={load.found} /> {t("{n} gefunden", { n: load.found === 1 ? t("Partie") : t("Partien") })}
              </strong>
            </div>
            <div class="stage-meter busy" style={{ marginTop: "12px" }}>
              <span />
            </div>
          </div>
        )}
        {load.phase === "busy" && <Thoughts lines={thoughts} />}
        {look && (
          <>
            <div class="stage-stats">
              <div class="stage-stat good">
                <b>
                  <CountUp value={look.wins} />
                </b>
                <span>{look.wins === 1 ? t("Sieg") : t("Siege")}</span>
              </div>
              <div class="stage-stat">
                <b>
                  <CountUp value={look.draws} />
                </b>
                <span>{t("Remis")}</span>
              </div>
              <div class="stage-stat bad">
                <b>
                  <CountUp value={look.losses} />
                </b>
                <span>{look.losses === 1 ? t("Niederlage") : t("Niederlagen")}</span>
              </div>
            </div>
            <div class="stage-panel">
              <div class="stage-wdl" aria-hidden="true">
                <span class="w" style={{ flex: look.wins || 0.001 }} />
                <span class="d" style={{ flex: look.draws || 0.001 }} />
                <span class="l" style={{ flex: look.losses || 0.001 }} />
              </div>
              <div class="stage-row" style={{ marginTop: "12px" }}>
                <span>
                  {t("{n} mit Weiß, {n2} mit Schwarz", { n: plural(look.white, t("Partie"), t("Partien")), n2: look.games - look.white })}
                </span>
                {look.bullet > 0 && <span class="faint">{t("davon {bullet} Bullet", { bullet: look.bullet })}</span>}
              </div>
            </div>
            <Thoughts lines={thoughts} />
          </>
        )}
      </Stage>
    );
  }

  if (step === "analysis") {
    return (
      <Stage
        {...common}
        mood={finding?.costliest ? "wow" : "think"}
        say={finding ? t("Die ersten Partien sind durch.") : t("Jetzt schaue ich mir jeden Zug an.")}
        sub={<p>{finding ? t("Hier ist, was ich bisher sehe. Mit jeder weiteren Partie wird das Bild genauer.") : t("Erst ein schneller Überblick über alle Partien, danach gehe ich alles noch einmal gründlich durch.")}</p>}
        actions={nextButton(passDone ? t("Zeig mir die App") : t("Weiter, die Analyse läuft mit"))}
      >
        <AnalysisPanel p={pass} done={passDone} />
        {finding ? (
          <FindingCard f={finding} onOpen={openSpot} />
        ) : (
          <>
            <Thoughts lines={thoughts} />
            <div class="stage-points">
              <StagePoint icon={<IconBolt />} title={t("Erste Ergebnisse in wenigen Minuten")}>
                
                {t("Sobald die erste Partie durch ist, zeige ich dir hier deinen ersten Befund.")}
              </StagePoint>
              <StagePoint icon={<IconCpu />} title={t("Alles bleibt auf deinem Gerät")}>
                
                {t("Die Engine rechnet in deinem Browser. Du kannst die App währenddessen normal benutzen.")}
              </StagePoint>
            </div>
          </>
        )}
      </Stage>
    );
  }

  const stop = tourStop(step);
  if (stop) {
    return (
      <Stage {...common} mood="happy" say={stop.say} sub={<p>{stop.sub}</p>} actions={nextButton(t("Weiter"))}>
        <Illus kind={stop.illus} />
        <div class="stage-points">
          {stop.points.map((p) => (
            <StagePoint key={p.title} title={p.title}>
              {p.text}
            </StagePoint>
          ))}
        </div>
      </Stage>
    );
  }

  // "ready": with a first finding this is the moment it pays off.
  const imported = load.phase === "done";
  const wow = imported && finding;
  return (
    <Stage
      {...common}
      layout={wow ? "split" : "center"}
      mood="wow"
      say={wow ? (finding.costliest ? t("Hier verlierst du Punkte.") : t("Dein erster Befund ist da.")) : imported ? t("Dein Profil füllt sich gerade.") : t("Das war's. Viel Spaß!")}
      sub={
        <p>
          {wow
            ? t("Das ist erst der Anfang: Die Analyse läuft im Hintergrund weiter, und aus jedem Fehler baue ich eine Aufgabe für dein Training.")
            : imported
            ? t("Die Analyse läuft im Hintergrund weiter. Je mehr Partien fertig sind, desto genauer werden deine Stärken und Schwächen. Auf jeder Seite erkläre ich dir beim ersten Besuch, was du siehst.")
            : t("Auf jeder Seite erkläre ich dir beim ersten Besuch, was du siehst. Den Rundgang findest du jederzeit in der Seitenleiste wieder.")}
        </p>
      }
      closeLabel={t("Schließen")}
      children={wow ? <FindingCard f={finding} onOpen={openSpot} /> : undefined}
      actions={
        <>
          {imported && (
            <button class="btn" onClick={() => finish(() => navigate({ view: "games" }))}>
              <IconGames />
              
              {t("Meine Partien")}
            </button>
          )}
          {!imported && (
            <button class="btn" onClick={() => finish(() => navigate({ view: "training" }))}>
              <IconTraining />
              
              {t("Zum Training")}
            </button>
          )}
          {nextButton(t("Zur Startseite"))}
        </>
      }
    />
  );
}
