// Records of the friends group: achievements that are genuinely rare, each
// with the game it happened in.
//
// A record only counts once it clears a bar that ordinary play does not
// reach (a win streak of 6, a win against someone 200 points stronger, a
// comeback from 5 %): "won a game in 30 moves" is something everybody has
// and says nothing. Every record shows the runner-up, so it is visible how
// clear it is, and records that nobody has reached yet are listed with the bar
// they need. Bot games never count. Opponent strengths are compared on one
// scale (see fide.ts), so a Lichess upset and a Chess.com upset are measured
// alike. A record stays with whoever set it first, like a real one.

import { isBotGame } from "../metrics/bots";
import { filterGames } from "../metrics/filters";
import { type Outcome, outcomeFor, parseMoves, parseSummary, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { detectSpeedCategory } from "../metrics/speed";
import { toLichessBlitz } from "../profile/fide";
import { fmt as fmtDot } from "../profile/num";
import { headToHead } from "./h2h";
import { eloText, performanceMle } from "./strength";

// German decimal comma: "92,5".
const fmt = (x: number, digits: number) => fmtDot(x, digits).replace(".", ",");

export interface RecordMember {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
}

export interface GroupRecord {
  key: string;
  title: string;
  /** What it takes to set this record, e.g. "ab 6 Siegen in Folge". */
  bar: string;
  /** Null while nobody has cleared the bar. */
  holder: { id: string; name: string; is_me: boolean } | null;
  value: number | null;
  /** The record in words, e.g. "9 Siege in Folge". */
  text: string;
  /** Where and when, e.g. "gegen kev1n · 03.11.2026". */
  detail: string;
  /** Best other member who cleared the bar too (null: the holder is the only one). */
  runner_up: { id: string; name: string; text: string } | null;
  /** The runner-up reached exactly the same value (earlier game keeps the record). */
  tied: boolean;
  game_id: string | null;
  played_at: number | null;
}

// Bars: rare at club level, so a record means something.
const STREAK_BAR = 6;
const UPSET_BAR = 200; // Lichess-scale points
const COMEBACK_BAR = 0.05; // winning chance
const MATE_BAR = 25; // own moves
const CLEAN_BAR = 8; // analysed games without a blunder in a row
const ACCURACY_BAR = 90;
const ACCURACY_MOVES = 25;
const PEAK_GAMES = 20;
const DUEL_STREAK_BAR = 4;
// A comeback or a brilliant game against a much weaker opponent is no feat.
const WEAKER_OK = 100;

interface Game {
  g: RawGame;
  color: "white" | "black";
  at: number;
  result: Outcome | null;
  member: RecordMember;
  /** Own and opponent rating on the common scale (null when unrated). */
  own: number | null;
  opp: number | null;
}

const dateDe = (at: number | null) => (at === null ? "" : new Date(at * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }));
const opponent = (x: Game) => String((x.color === "white" ? x.g.black : x.g.white) ?? "?");
const speedOf = (g: RawGame) => (g.chess960 ? "Chess960" : (g.speed_category || "").trim() || detectSpeedCategory(g.time_control, g.event, g.source) || "Other");
const elo = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface Candidate {
  x: Game;
  v: number;
}

interface Def {
  key: string;
  title: string;
  bar: string;
  higher: boolean;
  text: (v: number) => string;
  detail: (c: Candidate) => string;
}

export function groupRecords(members: RecordMember[], games: RawGame[], format = "All Formats", date = "All Time"): GroupRecord[] {
  const byMember = new Map<string, Game[]>();
  for (const m of members) {
    const list: Game[] = [];
    for (const [g, color] of filterGames(games, m.usernames, "All Colors", format, "All Sources", date)) {
      const at = parsePlayedAt(g);
      if (at === null || isBotGame(g, color)) continue;
      const source = String(g.source || "file").toLowerCase();
      const conv = (v: unknown) => {
        const r = elo(v);
        return r === null ? null : toLichessBlitz(r, source, speedOf(g));
      };
      list.push({
        g,
        color,
        at,
        result: outcomeFor(g.result, color),
        member: m,
        own: conv(color === "white" ? g.white_elo : g.black_elo),
        opp: conv(color === "white" ? g.black_elo : g.white_elo),
      });
    }
    list.sort((a, b) => a.at - b.at);
    byMember.set(m.id, list);
  }
  const side = (x: Game) => (parseSummary(x.g.summary_json)?.[x.color] ?? null) as Record<string, unknown> | null;
  const analyzed = (x: Game) => parseSummary(x.g.summary_json)?.analysis_status === "completed" && side(x) !== null;
  // White makes the odd plies: 25 plies are 13 moves for White but 12 for Black.
  const ownMoves = (x: Game) => {
    const plies = parseMoves(x.g.moves_json).length;
    return x.color === "white" ? Math.ceil(plies / 2) : Math.floor(plies / 2);
  };
  const notMuchWeaker = (x: Game) => x.own === null || x.opp === null || x.opp >= x.own - WEAKER_OK;
  const vs = (c: Candidate) => `gegen ${opponent(c.x)} · ${dateDe(c.x.at)}`;
  const until = (c: Candidate) => `bis ${dateDe(c.x.at)}`;

  // Each record: every member's personal best (ties: earlier game), then the group's.
  const defs: { def: Def; best: (list: Game[]) => Candidate[] }[] = [
    {
      def: {
        key: "peak",
        title: "Stärkste Phase",
        bar: `ab ${PEAK_GAMES} gewerteten Partien`,
        higher: true,
        text: (v) => `Leistung Elo ${eloText(v)}`,
        detail: (c) => `über ${PEAK_GAMES} Partien in Folge, ${until(c)}`,
      },
      best: (list) => {
        const rated = list.filter((x) => x.result !== null && x.opp !== null);
        const out: Candidate[] = [];
        for (let i = PEAK_GAMES; i <= rated.length; i++) {
          const win = rated.slice(i - PEAK_GAMES, i).map((x) => ({ opp: x.opp as number, score: x.result === "win" ? 1 : x.result === "draw" ? 0.5 : 0 }));
          const avg = win.reduce((s, w) => s + w.opp, 0) / win.length;
          out.push({ x: rated[i - 1], v: performanceMle(win, avg).value });
        }
        return out;
      },
    },
    {
      def: {
        key: "upset",
        title: "Größter Coup",
        bar: `ein Sieg gegen jemanden ${UPSET_BAR}+ Punkte stärker`,
        higher: true,
        text: (v) => `Sieg gegen ${fmt(v, 0)} Punkte Stärkere`,
        detail: vs,
      },
      best: (list) =>
        list
          .filter((x) => x.result === "win" && x.own !== null && x.opp !== null)
          .map((x) => ({ x, v: (x.opp as number) - (x.own as number) }))
          .filter((c) => c.v >= UPSET_BAR),
    },
    {
      def: {
        key: "streak",
        title: "Siegesserie",
        bar: `ab ${STREAK_BAR} Siegen in Folge`,
        higher: true,
        text: (v) => `${v} Siege in Folge`,
        detail: until,
      },
      best: (list) => {
        const out: Candidate[] = [];
        let run = 0;
        for (const x of list) {
          if (x.result === null) continue;
          run = x.result === "win" ? run + 1 : 0;
          if (run >= STREAK_BAR) out.push({ x, v: run });
        }
        return out;
      },
    },
    {
      def: {
        key: "comeback",
        title: "Aufholjagd",
        bar: `ein Sieg aus höchstens ${fmt(COMEBACK_BAR * 100, 0)} % Gewinnchance`,
        higher: false,
        text: (v) => `aus ${v < 0.01 ? "unter 1" : fmt(v * 100, 0)} % gewonnen`,
        detail: (c) => `Gewinnchance zwischendurch, ${vs(c)}`,
      },
      best: (list) =>
        list
          .filter((x) => x.result === "win" && analyzed(x) && notMuchWeaker(x))
          .map((x) => {
            let low = 1;
            for (const mv of parseMoves(x.g.moves_json)) {
              const w = Number(mv.win_chance_after);
              if (Number.isFinite(w)) low = Math.min(low, x.color === "white" ? w : 1 - w);
            }
            return { x, v: low };
          })
          .filter((c) => c.v <= COMEBACK_BAR),
    },
    {
      def: {
        key: "best_game",
        title: "Partie des Lebens",
        bar: `${ACCURACY_BAR} %+ Genauigkeit in einem Sieg über ${ACCURACY_MOVES}+ Züge`,
        higher: true,
        text: (v) => `${fmt(v, 1)} % Genauigkeit`,
        detail: (c) => `im Sieg ${vs(c)}`,
      },
      best: (list) =>
        list
          .filter((x) => x.result === "win" && analyzed(x) && ownMoves(x) >= ACCURACY_MOVES && notMuchWeaker(x))
          .map((x) => ({ x, v: Number(side(x)?.accuracy ?? 0) }))
          .filter((c) => c.v >= ACCURACY_BAR),
    },
    {
      def: {
        key: "mate",
        title: "Kurzer Prozess",
        bar: `ein Matt in höchstens ${MATE_BAR} Zügen`,
        higher: false,
        text: (v) => `Matt im ${v}. Zug`,
        detail: vs,
      },
      best: (list) =>
        list
          .filter((x) => x.result === "win" && String(x.g.termination_mode ?? "").toLowerCase() === "checkmate" && notMuchWeaker(x))
          .map((x) => ({ x, v: ownMoves(x) }))
          .filter((c) => c.v > 0 && c.v <= MATE_BAR),
    },
    {
      def: {
        key: "clean",
        title: "Ohne Patzer",
        bar: `ab ${CLEAN_BAR} analysierten Partien in Folge ohne Patzer`,
        higher: true,
        text: (v) => `${v} Partien ohne Patzer`,
        detail: (c) => `in Folge, ${until(c)}`,
      },
      best: (list) => {
        // Unanalysed games do not break the run: there is nothing to judge.
        const out: Candidate[] = [];
        let run = 0;
        for (const x of list) {
          if (!analyzed(x)) continue;
          run = Number(side(x)?.Blunder ?? 0) > 0 ? 0 : run + 1;
          if (run >= CLEAN_BAR) out.push({ x, v: run });
        }
        return out;
      },
    },
  ];

  const out: GroupRecord[] = defs.map(({ def, best }) => {
    const personal = members
      .map((m) => pick(best(byMember.get(m.id) ?? []), def.higher))
      .filter((c): c is Candidate => c !== null);
    return finish(def, personal);
  });
  out.push(duelStreak(members, games, format, date));
  return out;
}

/** The best candidate of one member: higher or lower value, ties to the earlier game. */
function pick(cands: Candidate[], higher: boolean): Candidate | null {
  let top: Candidate | null = null;
  for (const c of cands) {
    if (!Number.isFinite(c.v)) continue;
    if (!top || (higher ? c.v > top.v : c.v < top.v) || (c.v === top.v && c.x.at < top.x.at)) top = c;
  }
  return top;
}

function finish(def: Def, personal: Candidate[]): GroupRecord {
  const sorted = [...personal].sort((a, b) => (def.higher ? b.v - a.v : a.v - b.v) || a.x.at - b.x.at);
  const [top, next] = sorted;
  if (!top) return { key: def.key, title: def.title, bar: def.bar, holder: null, value: null, text: "noch offen", detail: def.bar, runner_up: null, tied: false, game_id: null, played_at: null };
  return {
    key: def.key,
    title: def.title,
    bar: def.bar,
    holder: { id: top.x.member.id, name: top.x.member.name, is_me: top.x.member.is_me },
    value: top.v,
    text: def.text(top.v),
    detail: def.detail(top),
    runner_up: next ? { id: next.x.member.id, name: next.x.member.name, text: def.text(next.v) } : null,
    tied: Boolean(next && next.v === top.v),
    game_id: top.x.g.id ? String(top.x.g.id) : null,
    played_at: top.x.at,
  };
}

/** Longest run of wins of one member against one other member of the group. */
function duelStreak(members: RecordMember[], games: RawGame[], format: string, date: string): GroupRecord {
  const def: Def = {
    key: "duel",
    title: "Angstgegner",
    bar: `ab ${DUEL_STREAK_BAR} Siegen in Folge gegen denselben Freund`,
    higher: true,
    text: (v) => `${v} Siege in Folge`,
    detail: () => "",
  };
  const personal: (Candidate & { rival: string })[] = [];
  for (const a of members) {
    let best: (Candidate & { rival: string }) | null = null;
    for (const b of members) {
      if (a === b) continue;
      const h = headToHead(games, a.usernames, b.usernames, format, date);
      let run = 0;
      for (const g of [...h.recent].reverse()) {
        run = g.score === 1 ? run + 1 : 0;
        if (run >= DUEL_STREAK_BAR && (!best || run > best.v)) {
          const at = g.played_at ?? 0;
          best = { x: { g: { id: g.id }, color: g.color, at, result: "win", member: a, own: null, opp: null }, v: run, rival: b.name };
        }
      }
    }
    if (best) personal.push(best);
  }
  const rec = finish(def, personal);
  const top = personal.find((p) => rec.holder && p.x.member.id === rec.holder.id);
  if (top) rec.detail = `gegen ${top.rival}, bis ${dateDe(top.x.at)}`;
  return rec;
}
