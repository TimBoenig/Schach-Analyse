// The first start, fullscreen with Lucena: who she is, where the user plays,
// their games arriving live, the engine starting, then a walk through the
// four areas. Everything she says about the user is counted from the games
// that were just imported.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { autoAnalyze, subscribeQueue, type QueueState } from "../../app/analysisService";
import { importAccount, type Site } from "../../app/accountImport";
import { BRAND } from "../../brand";
import { type FirstLook, firstLook } from "../../domain/firstLook";
import { batchProgress } from "../../domain/firstPass";
import { getSetting } from "../../storage/db";
import type { Mood } from "../Coach";
import { IconBolt, IconChevron, IconCpu, IconGames, IconInsights, IconTraining, IconUpload } from "../icons";
import { CountUp } from "../kit";
import { navigate } from "../router";
import { Illus } from "./Illus";
import { backStep, canAdvance, type ImportPhase, onboardPath, type SitePick, tourStop } from "./script";
import { Stage, StagePoint } from "./Stage";
import { markSeen } from "./store";
import { t } from "../../i18n";

const SITE_LABEL: Record<Site, string> = { chesscom: "chess.com", lichess: "Lichess" };

const SITES: { key: SitePick; label: string; sub: string; mark: string }[] = [
  { key: "chesscom", label: "chess.com", sub: t("Ich hole deine Partien der letzten drei Monate."), mark: "C" },
  { key: "lichess", label: "Lichess", sub: t("Ich hole deine letzten 100 Partien."), mark: "L" },
  { key: "none", label: t("Noch nirgends"), sub: t("Oder ich habe meine Partien als PGN-Datei."), mark: "?" },
];

type Load = { phase: "idle" } | { phase: "busy"; label: string; found: number } | { phase: "done"; look: FirstLook; queued: boolean } | { phase: "empty" } | { phase: "error"; message: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

function useQueue(): QueueState | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/** Live state of the engine's first pass over the imported games. */
function AnalysisPanel() {
  const q = useQueue();
  const p = q ? batchProgress({ finished: q.finished, current: q.current, queued: q.queued.length, done: q.done, total: q.total, deeper: q.deeper }) : null;
  const running = Boolean(p && !p.idle);
  const pct = p ? Math.round(p.fraction * 100) : 0;
  return (
    <>
      <div class="stage-panel">
        <div class="stage-row">
          <strong>{running ? t("Partie {index} von {games}", { index: p!.index, games: p!.games }) : p && p.games ? t("Erste Runde fertig") : t("Die Engine startet …")}</strong>
          <span class="faint tnum">{running ? `${pct} %` : ""}</span>
        </div>
        <div class={`stage-meter${running || (p && p.games) ? "" : " busy"}`} style={{ marginTop: "12px" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Fortschritt der Analyse")}>
          <span style={running ? { width: `${Math.max(3, pct)}%` } : p && p.games ? { width: "100%" } : undefined} />
        </div>
      </div>
      <div class="stage-points">
        <StagePoint icon={<IconBolt />} title={t("Erst ein schneller Überblick")}>
          
          {t("Ich schaue jede Partie kurz durch, damit du nach wenigen Minuten Ergebnisse siehst.")}
        </StagePoint>
        <StagePoint icon={<IconCpu />} title={t("Danach gründlich")}>
          
          {t("Dann gehe ich alles noch einmal tiefer durch und die Werte werden genauer. Das läuft im Hintergrund, du kannst die App normal benutzen.")}
        </StagePoint>
        <StagePoint icon={<IconInsights />} title={t("Alles bleibt auf deinem Gerät")}>
          
          {t("Die Engine rechnet in deinem Browser. Ein Konto brauchst du nur, wenn du deine Analysen auf mehreren Geräten haben willst.")}
        </StagePoint>
      </div>
    </>
  );
}

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [pick, setPick] = useState<SitePick | null>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [load, setLoad] = useState<Load>({ phase: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const path = useMemo(() => onboardPath(pick), [pick]);
  const step = path[Math.min(index, path.length - 1)];
  const phase: ImportPhase = load.phase;

  // A name the import dialog used before is offered again.
  useEffect(() => {
    void getSetting<Record<string, string>>("import.lastUser", {}).then((u) => {
      const known = (["chesscom", "lichess"] as const).find((s) => u[s]);
      if (known && alive.current) setName((n) => n || u[known]);
    });
  }, []);
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
    try {
      const { games } = await importAccount(pick, who, {
        months: 3,
        count: 100,
        onProgress: (label) => alive.current && setLoad({ phase: "busy", label, found }),
        onStored: (batch) => {
          found += batch.length;
          if (alive.current) setLoad((l) => (l.phase === "busy" ? { ...l, found } : l));
        },
      });
      const look = firstLook(games, who);
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

  const common = {
    steps: path.length,
    step: index,
    stepKey: step,
    onBack: back,
    onNext: next,
    onClose: () => finish(),
  };
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
              
              {t("Weiter mit")} <kbd>{t("Enter")}</kbd>
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
      <Stage {...common} mood={name.trim() ? "happy" : "think"} say={t("Wie heißt du bei {site}?", { site })} sub={<p>{t("Dein Benutzername reicht, kein Passwort. Ein Konto bei")} {BRAND}  {t("brauchst du nicht.")}</p>} actions={nextButton(t("Partien holen"), !ok)}>
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
        <p class="stage-note">{t("Ich lese nur, was bei")} {site}  {t("öffentlich zu sehen ist.")}</p>
      </Stage>
    );
  }

  if (step === "import") {
    const site = SITE_LABEL[pick as Site];
    const failed = load.phase === "error" || load.phase === "empty";
    const look = load.phase === "done" ? load.look : null;
    const mood: Mood = failed ? "sad" : look ? "wow" : "think";
    const say = load.phase === "error" ? t("Das hat nicht geklappt.") : load.phase === "empty" ? t("Ich habe keine Partien gefunden.") : look ? t("{plural} sind da.", { plural: plural(look.games, t("Partie"), t("Partien")) }) : t("Ich hole deine Partien …");
    const sub =
      load.phase === "error" ? (
        <p>{load.message}</p>
      ) : load.phase === "empty" ? (
        <p>
          
          {t("Unter „")}{name.trim()}{t("“ gibt es bei")} {site}  {t("in den letzten Monaten keine Partien. Stimmt der Name?")}
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
                <CountUp value={load.found} /> {load.found === 1 ? t("Partie") : t("Partien")} gefunden
              </strong>
            </div>
            <div class="stage-meter busy" style={{ marginTop: "12px" }}>
              <span />
            </div>
          </div>
        )}
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
                  {plural(look.white, t("Partie"), t("Partien"))}  {t("mit Weiß,")} {look.games - look.white}  {t("mit Schwarz")}
                </span>
                {look.bullet > 0 && <span class="faint">davon {look.bullet} Bullet</span>}
              </div>
            </div>
          </>
        )}
      </Stage>
    );
  }

  if (step === "analysis") {
    return (
      <Stage {...common} mood="think" say={t("Jetzt schaue ich mir jeden Zug an.")} sub={<p>{t("Währenddessen zeige ich dir, wo du gleich was findest.")}</p>} actions={nextButton(t("Zeig mir die App"))}>
        <AnalysisPanel />
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

  // "ready"
  const imported = load.phase === "done";
  return (
    <Stage
      {...common}
      layout="center"
      mood="wow"
      say={imported ? t("Dein Profil füllt sich gerade.") : t("Das war's. Viel Spaß!")}
      sub={
        <p>
          {imported
            ? t("Die Analyse läuft im Hintergrund weiter. Je mehr Partien fertig sind, desto genauer werden deine Stärken und Schwächen. Auf jeder Seite erkläre ich dir beim ersten Besuch, was du siehst.")
            : t("Auf jeder Seite erkläre ich dir beim ersten Besuch, was du siehst. Den Rundgang findest du jederzeit in der Seitenleiste wieder.")}
        </p>
      }
      closeLabel={t("Schließen")}
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
