// Shared pieces of the players pages (list, league and duel page): number
// formats, the filters, bulk actions and the player colours.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue, subscribeQueue, type QueueState } from "../../app/analysisService";
import { importAllPlayers } from "../../app/players";
import { buildProfileInWorker } from "../../app/profileClient";
import { isBulletGame } from "../../domain/analysisDepth";
import { getUserColor } from "../../domain/metrics";
import { playerUsernames, type TrackedPlayer } from "../../domain/players";
import type { PlayerProfile } from "../../domain/profile";
import type { StoredGame } from "../../domain/types";
import { IconPlay, IconSync } from "../icons";
import { useBulletPrefs } from "../useAnalysisPrefs";
import { FORMATS, formatOptionLabel, PeriodSelect } from "../useProfile";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const pct0 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : `${Math.round(v)} %`);
export const de = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");
export const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${de(Math.abs(v), digits)}`;
/** Points like a crosstable: 6½ instead of 6.5. */
export const half = (v: number) => (v % 1 ? `${Math.floor(v) || ""}½` : String(v));

export function formatFactor(key: string, v: number | null): string {
  if (v === null) return "–";
  switch (key) {
    case "rating":
    case "activity":
      return String(Math.round(v));
    case "expectation":
      return signed(v);
    case "blunders":
      return de(v, 2);
    case "score":
    case "accuracy":
    case "h2h":
      return `${de(v, v >= 99.95 ? 0 : 1)} %`;
    default:
      return String(Math.round(v));
  }
}

export function gamesOf(all: StoredGame[], names: string[]): StoredGame[] {
  return all.filter((g) => getUserColor(g, names));
}

/** Profile for one set of usernames; only their games travel to the worker. */
export function profileFor(all: StoredGame[], names: string[], format: string, date: string): Promise<PlayerProfile> {
  return buildProfileInWorker({ games: gamesOf(all, names), usernames: names, format, date, color: "All Colors" });
}

export function useQueue(): QueueState | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/** Format and period only: the colour filter would flip meaning between players. */
export function PlayerFilters({
  format,
  date,
  onFormat,
  onDate,
}: {
  format: string;
  date: string;
  onFormat: (v: string) => void;
  onDate: (v: string) => void;
}) {
  const { excludeBullet } = useBulletPrefs();
  return (
    <div class="filters">
      <select value={format} onChange={(e) => onFormat(e.currentTarget.value)} aria-label="Bedenkzeit">
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {formatOptionLabel(f, excludeBullet)}
          </option>
        ))}
      </select>
      <PeriodSelect value={date} onChange={onDate} />
    </div>
  );
}

/** Loads new games for all given players in one go. */
export function RefreshAll({ players, label = "Alle aktualisieren" }: { players: TrackedPlayer[]; label?: string }) {
  const [busy, setBusy] = useState("");
  const online = players.filter((p) => p.accounts.some((a) => a.source !== "other"));
  if (online.length < 2) return null;
  const run = async () => {
    setBusy("Lade Partien …");
    const { imported, failed } = await importAllPlayers(online, { onProgress: setBusy });
    setBusy(
      `${plural(imported, "neue Partie", "neue Partien")} geladen${failed.length ? `, nicht erreichbar: ${failed.join(", ")}` : ""}.`,
    );
    window.setTimeout(() => setBusy(""), failed.length ? 6000 : 3000);
  };
  return (
    <span class="refresh-all">
      <button class="btn" disabled={Boolean(busy)} onClick={() => void run()} title="Neue Partien aller Spieler von Lichess und Chess.com laden">
        <IconSync /> {label}
      </button>
      {busy && (
        <span class="small muted" role="status">
          {busy}
        </span>
      )}
    </span>
  );
}

/**
 * Queues every not yet analysed game of the friends (all shown players when
 * nobody is marked as friend). The queue runs the newest games first.
 */
export function AnalyzeFriends({ players, games, short }: { players: TrackedPlayer[]; games: StoredGame[]; short?: boolean }) {
  const queue = useQueue();
  const { skipBullet } = useBulletPrefs();
  const shown = players.filter((p) => !p.hidden);
  const friends = shown.some((p) => p.friend) ? shown.filter((p) => p.friend) : shown;
  const open = useMemo(() => {
    const names = friends.flatMap(playerUsernames);
    return gamesOf(games, names)
      .filter((g) => g.summary_json?.analysis_status !== "completed" && !(skipBullet && isBulletGame(g)))
      .map((g) => g.id);
  }, [games, friends.map((p) => p.id).join("|"), skipBullet]);
  const inQueue = new Set([...(queue?.queued ?? []), ...(queue?.current ? [queue.current] : [])]);
  const waiting = open.filter((id) => !inQueue.has(id));
  const running = open.length - waiting.length;
  if (!open.length) return null;
  const who = friends.length === shown.length && !shown.some((p) => p.friend) ? "aller Spieler" : "deiner Freunde";
  return (
    <button
      class="btn"
      disabled={!waiting.length}
      onClick={() => void enqueue(waiting)}
      title={`Alle noch nicht analysierten Partien ${who}, die neuesten zuerst${skipBullet ? ", ohne Bullet" : ""}`}
    >
      <IconPlay />{" "}
      {waiting.length
        ? short
          ? `${waiting.length} analysieren`
          : `Neue Partien ${who} analysieren (${waiting.length})`
        : `Analyse läuft (${plural(running, "Partie", "Partien")})`}
    </button>
  );
}

// ---------- player colours ----------

/**
 * Every friend keeps one colour on all pages (charts, avatars, the league
 * track): taken from their place in the friends list, so hiding someone does
 * not repaint the others. You are always the page's own ink.
 */
export const TONES = 6;

export function toneOf(players: TrackedPlayer[], id: string): string {
  if (id === "ich") return "tone-me";
  const i = players.filter((p) => p.friend).findIndex((p) => p.id === id);
  if (i >= 0) return `tone-${i % TONES}`;
  // Opponents get a colour from their id, so it stays put too.
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `tone-${h % TONES}`;
}

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function Avatar({ name, tone, size = "md", ring }: { name: string; tone: string; size?: "sm" | "md" | "lg" | "xl"; ring?: boolean }) {
  return (
    <span class={`pl-avatar ${size} ${tone}${ring ? " ring" : ""}`} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

/** A coloured name chip: avatar and name, used in lists and legends. */
export function Who({ name, tone, children }: { name: string; tone: string; children?: ComponentChildren }) {
  return (
    <span class="pl-who">
      <Avatar name={name} tone={tone} size="sm" />
      <strong>{name}</strong>
      {children}
    </span>
  );
}
