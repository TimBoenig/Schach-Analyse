// The app's frame around every page: a labelled sidebar on wide screens, an
// icon rail on medium ones and a tab bar on phones. All three read AREAS, so
// a page sits in the same place everywhere.
import { useEffect, useState } from "preact/hooks";

import { cancelAll, subscribeQueue, type QueueState } from "../app/analysisService";
import { BRAND } from "../brand";
import { batchProgress, type BatchProgress } from "../domain/firstPass";
import { useSyncStatus } from "./AccountView";
import { IconAccount, IconSearch } from "./icons";
import { MOD } from "./keys";
import { AREAS, type Area, MAIN_AREAS } from "./Layout";
import { navigate, type Route } from "./router";
import { openStage } from "./stage/store";
import { t, tj } from "../i18n";

const SETTINGS_AREA = AREAS.find((a) => a.id === "settings")!;

interface Job {
  progress: BatchProgress;
  /** What the engine is doing right now, in two or three words. */
  label: string;
  pct: number;
}

/** The background analysis, or null while the engine is idle. */
function useJob(): Job | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  if (!q) return null;
  const progress = batchProgress({ finished: q.finished, current: q.current, queued: q.queued.length, done: q.done, total: q.total, deeper: q.deeper });
  if (progress.idle) return null;
  const label = q.pass === "deep" ? t("Gründliche Runde") : q.pass === "quick" ? t("Schneller Überblick") : t("Analyse");
  return { progress, label, pct: Math.round(progress.fraction * 100) };
}

function JobBar({ pct }: { pct: number }) {
  return (
    <span class="side-job-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Fortschritt der Analyse")}>
      <span style={{ width: `${Math.max(3, pct)}%` }} />
    </span>
  );
}

/** Sidebar entry: who is signed in and whether the last sync worked. */
function AccountItem({ active, onClick }: { active: boolean; onClick: () => void }) {
  const s = useSyncStatus();
  if (s.phase === "off") return null;
  const signedIn = Boolean(s.email) && s.phase !== "signed-out";
  return (
    <button class={`side-item side-account${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined} title={signedIn ? (s.email ?? t("Konto")) : t("Anmelden")}>
      <span class={`account-avatar small${signedIn ? "" : " empty"}`}>
        {signedIn ? (s.email ?? "?").slice(0, 1).toUpperCase() : <IconAccount />}
        {signedIn && <span class={`sync-dot ${s.phase}`} />}
      </span>
      <span class="side-label">
        {signedIn ? (
          <>
            <span class="account-chip-mail">{s.email}</span>
            <span class="account-chip-state">{s.phase === "running" ? t("Gleicht ab …") : s.phase === "error" ? t("Abgleich gestört") : t("Online gesichert")}</span>
          </>
        ) : (
          <>
            
            {tj("Anmelden{x}", { x: <span class="account-chip-state">{t("Analysen auf allen Geräten")}</span> })}
          </>
        )}
      </span>
    </button>
  );
}

export interface ShellNavProps {
  route: Route;
  area: Area;
  /** Whether the engine is analysing games right now. */
  analysing: boolean;
  onNavigate: (r: Route) => void;
  onSearch: () => void;
  onKeys: () => void;
}

export function Sidebar({ route, area, analysing, onNavigate, onSearch, onKeys }: ShellNavProps) {
  const job = useJob();
  const item = (a: Area) => (
    <button
      class={`side-item${area.id === a.id ? " active" : ""}`}
      onClick={() => onNavigate(a.sub[0].route)}
      aria-current={area.id === a.id ? "page" : undefined}
      title={a.hint}
    >
      <a.icon />
      <span class="side-label">{a.label}</span>
      {a.id === "games" && analysing && <span class="side-status" title={t("Analyse läuft")} />}
    </button>
  );
  // An area with its sub-pages below while it is open; the others stay folded
  // so the list stays short. Settings too: wide screens show no tab row, so
  // "Analyse" and "Daten & Export" are only reachable from here. Account and
  // legal notice have their own entries at the bottom and are not repeated.
  const entry = (a: Area) => {
    const subs = a.sub.filter((s) => s.route.view !== "account" && s.route.view !== "legal");
    return (
      <>
        {item(a)}
        {area.id === a.id && subs.length > 1 && (
          <div class="side-sub" role="group" aria-label={a.label}>
            {subs.map((s) => {
              const on = s.match(route);
              return (
                <button key={s.label} class={`side-subitem${on ? " active" : ""}`} aria-current={on ? "page" : undefined} onClick={() => onNavigate(s.route)}>
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  };
  return (
    <aside class="side" aria-label={t("Hauptnavigation")}>
      <a class="side-brand" href="#/" title={BRAND}>
        <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
        <span>{BRAND}</span>
      </a>
      <button class="side-search" onClick={onSearch} aria-label={t("Befehle und Suche")}>
        <IconSearch />
        <span>{t("Suchen")}</span>
        <kbd>{MOD} K</kbd>
      </button>
      <nav class="side-nav" aria-label={t("Bereiche")}>
        {MAIN_AREAS.map((a) => (
          <div key={a.id}>{entry(a)}</div>
        ))}
      </nav>
      <div class="side-spacer" />
      {job && (
        <div class="side-job" title={t("{label}: Partie {index} von {games}", { label: job.label, index: job.progress.index, games: job.progress.games })}>
          <div class="side-job-head">
            <span class="side-status" aria-hidden="true" />
            <strong>{job.label}</strong>
            <button onClick={cancelAll} title={t("Analyse anhalten")}>
              
              {t("Anhalten")}
            </button>
          </div>
          <span class="side-job-sub">
            
            {t("Partie {index} von {games}{n}", { index: job.progress.index, games: job.progress.games, n: job.progress.deeper > 0 ? t(" · danach gründlicher") : "" })}
          </span>
          <JobBar pct={job.pct} />
        </div>
      )}
      <button class="side-lucena" onClick={() => openStage({ kind: "tour" })} title={t("Rundgang mit Lucena")}>
        <span class="orb-mini" aria-hidden="true" />
        <span class="side-lucena-text">
          
          {tj("Rundgang mit Lucena{x}", { x: <small>{t("Die App in einer Minute")}</small> })}
        </span>
      </button>
      <AccountItem active={route.view === "account"} onClick={() => onNavigate({ view: "account" })} />
      {entry(SETTINGS_AREA)}
      <div class="side-meta">
        <button onClick={onKeys}>
          
          {tj("Tastenkürzel {x}", { x: <kbd>?</kbd> })}
        </button>
        <a href="#/rechtliches">{t("Impressum")}</a>
      </div>
    </aside>
  );
}

/** Phones: the five areas as a tab bar, and the running analysis as a strip above it. */
export function Dock({ area, analysing, onNavigate }: Pick<ShellNavProps, "area" | "analysing" | "onNavigate">) {
  const job = useJob();
  return (
    <>
      {job && (
        <button class="dock-job" onClick={() => navigate({ view: "games" })}>
          <span class="side-status" aria-hidden="true" />
          <span>
            {job.label} <small>{t("· Partie {index} von {games}", { index: job.progress.index, games: job.progress.games })}</small>
          </span>
          <JobBar pct={job.pct} />
        </button>
      )}
      <nav class="dock" aria-label={t("Hauptnavigation")}>
        {MAIN_AREAS.map((a) => (
          <button key={a.id} class={`dock-tab${area.id === a.id ? " active" : ""}`} onClick={() => onNavigate(a.sub[0].route)} aria-current={area.id === a.id ? "page" : undefined}>
            {a.id === "games" && analysing && <span class="side-status" title={t("Analyse läuft")} />}
            <a.icon />
            <span>{a.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
