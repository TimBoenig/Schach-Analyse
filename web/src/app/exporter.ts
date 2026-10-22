// Collects everything for the export from storage and hands the file to the browser.
import {
  type ExportSetting,
  gamesCsv,
  gamesInPeriod,
  gamesPgn,
  mergeCoachAnswers,
  parseBackup,
  COACH_ANSWERS_KEY,
} from "../domain/export";
import { localDay } from "../domain/training";
import { getSetting, listGames, listSettingRecords, putGames, putSettingRecords } from "../storage/db";
import { listCoachAnswers } from "./coachAnswers";
import { buildExportInWorker } from "./profileClient";

export type ExportKind = "json" | "csv" | "pgn";

function download(content: string, name: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL a moment longer than the click.
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function fileName(ext: string): string {
  return `schach-analyse-${localDay()}.${ext}`;
}

/** Builds and downloads the chosen export; resolves with the number of games in it. */
export async function exportData(kind: ExportKind, dateFilter: string): Promise<number> {
  const [games, usernames] = await Promise.all([listGames(), getSetting<string[]>("usernames", [])]);
  if (kind === "csv") {
    const scoped = gamesInPeriod(games, dateFilter);
    download(gamesCsv(scoped, usernames), fileName("csv"), "text/csv;charset=utf-8");
    return scoped.length;
  }
  if (kind === "pgn") {
    const scoped = gamesInPeriod(games, dateFilter);
    download(gamesPgn(scoped), fileName("pgn"), "application/x-chess-pgn");
    return scoped.length;
  }
  const settings: ExportSetting[] = (await listSettingRecords())
    .filter((s) => !s.deleted)
    .map((s) => ({ key: s.key, value: s.value, updated_at: s.updated_at }));
  const data = await buildExportInWorker({
    games,
    usernames,
    dateFilter,
    settings,
    coachAnswers: await listCoachAnswers(),
    today: localDay(),
    now: Date.now(),
  });
  download(JSON.stringify(data, null, 1), fileName("json"), "application/json");
  return data.games.length;
}

export interface RestoreResult {
  games: number;
  settings: number;
  answers: number;
}

/**
 * Restores a backup. Games are written as they are; settings only fill gaps,
 * so an old file never overwrites newer training progress. Names and coach
 * answers merge.
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const backup = parseBackup(await file.text());
  await putGames(backup.games);
  const local = new Map((await listSettingRecords()).filter((s) => !s.deleted).map((s) => [s.key, s.value]));
  const now = Date.now();
  const records = backup.settings
    .filter((s) => !local.has(s.key) && s.key !== "usernames")
    .map((s) => ({ key: s.key, value: s.value, updated_at: now }));
  const names = backup.settings.find((s) => s.key === "usernames")?.value;
  if (Array.isArray(names)) {
    const have = (local.get("usernames") as string[] | undefined) ?? [];
    const merged = [...have];
    for (const n of names) {
      if (typeof n === "string" && !merged.some((m) => m.toLowerCase() === n.toLowerCase())) merged.push(n);
    }
    if (merged.length !== have.length) records.push({ key: "usernames", value: merged, updated_at: now });
  }
  if (backup.coachAnswers.length) {
    const have = (local.get(COACH_ANSWERS_KEY) as Parameters<typeof mergeCoachAnswers>[0] | undefined) ?? [];
    records.push({ key: COACH_ANSWERS_KEY, value: mergeCoachAnswers(have, backup.coachAnswers), updated_at: now });
  }
  if (records.length) await putSettingRecords(records);
  return { games: backup.games.length, settings: records.length, answers: backup.coachAnswers.length };
}
