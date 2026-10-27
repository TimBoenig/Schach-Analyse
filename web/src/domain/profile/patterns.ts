// Recurring pattern detection across many games
// (port of src/backend/analysis/profile/patterns.py).
//
// Every detector returns a Pattern with a German explanation, a severity and
// concrete example positions so the user can jump straight into the games
// where the pattern happened.

import { trClassification, trColor, trPhaseIn, trPiece } from "../i18n";
import { type GameFeatures, type MoveEvent, moveLabel } from "./features";
import type { GameRef, Pattern } from "./models";
import { expectedScore } from "./benchmarks";
import { MIN_ERRORS, MIN_GROUP_GAMES, meansDiffer, ratesDiffer, scoreDeviation, scoresDiffer, shareAtLeast, shareBelow } from "./evidence";
import { avg, fmt } from "./num";

export const MAX_EXAMPLES = 8;
// Two games belong to the same session when they start less than 90 minutes apart.
export const SESSION_GAP_SECONDS = 90 * 60;
// Shares of errors ("35 % of your errors …") need this many serious errors, and
// the share must reach its threshold with 95 % confidence, not just by luck.
export const MIN_ERRORS_FOR_SHARE = MIN_ERRORS;

type Severity = Pattern["severity"];

function ref(f: GameFeatures, m: MoveEvent | null = null, detail = ""): GameRef {
  const opp = f.rec.opp_name;
  const when = f.date || "";
  if (m === null) {
    return { game_id: f.game_id, ply_index: -1, label: `gegen ${opp} (${when})`, detail };
  }
  return {
    game_id: f.game_id,
    ply_index: m.ply_index,
    label: `${moveLabel(m.move_number, f.rec.user_color === "white", m.san)} gegen ${opp}`,
    detail: detail || `${trClassification(m.classification)} · ${when}`,
  };
}

function examples(
  feats: GameFeatures[],
  pred: (m: MoveEvent) => boolean,
  limit = MAX_EXAMPLES,
): GameRef[] {
  const refs: GameRef[] = [];
  const recentFirst = [...feats].sort((a, b) => (b.played_at || 0) - (a.played_at || 0));
  for (const f of recentFirst) {
    const m = f.moves.find(pred);
    if (m) refs.push(ref(f, m));
    if (refs.length >= limit) break;
  }
  return refs;
}

function severity(share: number, high: number, mid: number): Severity {
  if (share >= high) return "hoch";
  if (share >= mid) return "mittel";
  return "niedrig";
}

const pattern = (
  key: string,
  title: string,
  text: string,
  sev: Severity,
  value: number,
  exampleRefs: GameRef[] = [],
): Pattern => ({ key, title, text, severity: sev, value, examples: exampleRefs });

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function detectPatterns(feats: GameFeatures[]): Pattern[] {
  const analyzed = feats.filter((f) => f.analyzed);
  const patterns: Pattern[] = [];
  if (!analyzed.length) return patterns;

  const serious: Array<[GameFeatures, MoveEvent]> = analyzed.flatMap((f) =>
    f.moves.filter((m) => m.is_serious_error).map((m) => [f, m] as [GameFeatures, MoveEvent]),
  );
  const nSerious = serious.length;

  // 1) Errors in winning positions (complacency / "Gewinnstellung vergeben").
  const winningErr = serious.filter(([, m]) => m.wp_before >= 0.7);
  if (nSerious >= MIN_ERRORS_FOR_SHARE && winningErr.length) {
    const share = winningErr.length / nSerious;
    if (share >= 0.2 && shareAtLeast(winningErr.length, nSerious, 0.12)) {
      patterns.push(
        pattern(
          "errors_when_winning",
          "Fehler in Gewinnstellungen",
          `${fmt(share * 100, 0)} % deiner Fehler und Patzer passieren, wenn du bereits ` +
            "klar besser stehst. Typisch: zu schnelles Spiel oder Sorglosigkeit, sobald " +
            "die Partie 'gewonnen' scheint.",
          severity(share, 0.35, 0.2),
          share,
          examples(analyzed, (m) => m.is_serious_error && m.wp_before >= 0.7),
        ),
      );
    }
  }

  // 2) Errors in worse positions (panic / collapse under pressure).
  const losingErr = serious.filter(([, m]) => m.wp_before <= 0.3);
  if (nSerious >= MIN_ERRORS_FOR_SHARE && losingErr.length) {
    const share = losingErr.length / nSerious;
    if (share >= 0.3 && shareAtLeast(losingErr.length, nSerious, 0.2)) {
      patterns.push(
        pattern(
          "errors_under_pressure",
          "Einbruch unter Druck",
          `${fmt(share * 100, 0)} % deiner schweren Fehler entstehen in schlechteren ` +
            "Stellungen. Statt zäh zu verteidigen, folgt oft der nächste Fehler.",
          severity(share, 0.45, 0.3),
          share,
          examples(analyzed, (m) => m.is_serious_error && m.wp_before <= 0.3),
        ),
      );
    }
  }

  // 3) Missing opponent mistakes.
  const chances = analyzed.reduce((s, f) => s + f.punish_chances, 0);
  const punished = analyzed.reduce((s, f) => s + f.punished, 0);
  if (chances >= MIN_ERRORS) {
    const rate = punished / chances;
    if (rate < 0.6 && shareBelow(punished, chances, 0.7)) {
      patterns.push(
        pattern(
          "missed_punish",
          "Gegnerfehler nicht bestraft",
          `Nach einem Fehler deines Gegners findest du nur in ${fmt(rate * 100, 0)} % der ` +
            "Fälle die Widerlegung. Frage dich nach jedem gegnerischen Zug: " +
            "'Was hat sich verändert, was hängt jetzt?'",
          severity(1 - rate, 0.55, 0.4),
          rate,
          examples(analyzed, (m) => m.after_opponent_error && m.wp_drop >= 0.1),
        ),
      );
    } else if (rate >= 0.8 && shareAtLeast(punished, chances, 0.7)) {
      patterns.push(
        pattern(
          "punisher",
          "Gegnerfehler werden bestraft",
          `Du nutzt ${fmt(rate * 100, 0)} % der gegnerischen Fehler direkt aus – ` +
            "ein starkes taktisches Auge.",
          "positiv",
          rate,
        ),
      );
    }
  }

  // 4) Rushed blunders (fast moves that lose a lot).
  const timed = serious.filter(([, m]) => m.time_spent !== null);
  if (timed.length >= MIN_ERRORS_FOR_SHARE) {
    const fast = timed.filter(([, m]) => (m.time_spent || 0) < 3 && !m.in_time_trouble);
    const share = fast.length / timed.length;
    if (share >= 0.35 && shareAtLeast(fast.length, timed.length, 0.25)) {
      patterns.push(
        pattern(
          "hasty_errors",
          "Schnellschüsse",
          `${fmt(share * 100, 0)} % deiner schweren Fehler hast du in unter 3 Sekunden ` +
            "gespielt – obwohl du nicht in Zeitnot warst. Ein kurzer Sicherheitscheck " +
            "vor dem Ziehen würde viele davon verhindern.",
          severity(share, 0.5, 0.35),
          share,
          examples(
            analyzed,
            (m) =>
              m.is_serious_error &&
              m.time_spent !== null &&
              m.time_spent < 3 &&
              !m.in_time_trouble,
          ),
        ),
      );
    }

    const trouble = timed.filter(([, m]) => m.in_time_trouble);
    const shareT = trouble.length / timed.length;
    if (shareT >= 0.3 && shareAtLeast(trouble.length, timed.length, 0.2)) {
      patterns.push(
        pattern(
          "time_trouble_errors",
          "Fehler in Zeitnot",
          `${fmt(shareT * 100, 0)} % deiner schweren Fehler passieren in Zeitnot. ` +
            "Du verbrauchst zu viel Zeit in früheren Phasen der Partie.",
          severity(shareT, 0.45, 0.3),
          shareT,
          examples(analyzed, (m) => m.is_serious_error && m.in_time_trouble),
        ),
      );
    }
  }

  // 5) Errors right after leaving opening theory.
  if (nSerious >= MIN_ERRORS_FOR_SHARE) {
    const early = serious.filter(
      ([, m]) => m.moves_since_book >= 0 && m.moves_since_book < 4 && m.move_number <= 15,
    );
    const gamesWithEarly = new Set(early.map(([f]) => f.game_id)).size;
    const shareGames = gamesWithEarly / analyzed.length;
    if (analyzed.length >= MIN_GROUP_GAMES && shareGames >= 0.2 && shareAtLeast(gamesWithEarly, analyzed.length, 0.12)) {
      patterns.push(
        pattern(
          "post_book_errors",
          "Fehler direkt nach der Theorie",
          `In ${fmt(shareGames * 100, 0)} % deiner Partien folgt ein schwerer Fehler ` +
            "innerhalb von 4 Zügen nach Verlassen der Eröffnungstheorie. Lerne nicht nur " +
            "Züge, sondern die typischen Pläne deiner Eröffnungen.",
          severity(shareGames, 0.35, 0.2),
          shareGames,
          examples(
            analyzed,
            (m) =>
              m.is_serious_error &&
              m.moves_since_book >= 0 &&
              m.moves_since_book < 4 &&
              m.move_number <= 15,
          ),
        ),
      );
    }
  }

  // 6) Phase where most serious errors happen.
  if (nSerious >= MIN_ERRORS_FOR_SHARE) {
    const phaseMoves = new Map<string, number>();
    for (const f of analyzed) {
      for (const m of f.moves) {
        if (!m.is_book) phaseMoves.set(m.phase, (phaseMoves.get(m.phase) ?? 0) + 1);
      }
    }
    const phaseErr = new Map<string, number>();
    for (const [, m] of serious) phaseErr.set(m.phase, (phaseErr.get(m.phase) ?? 0) + 1);
    const rates = new Map<string, number>();
    for (const [p, cnt] of phaseMoves) if (cnt >= 150) rates.set(p, (phaseErr.get(p) ?? 0) / cnt);
    if (rates.size >= 2) {
      let worst = "";
      let best = "";
      for (const [p, r] of rates) {
        if (!worst || r > (rates.get(worst) as number)) worst = p;
        if (!best || r < (rates.get(best) as number)) best = p;
      }
      const rw = rates.get(worst) as number;
      const rb = rates.get(best) as number;
      const clear = ratesDiffer(phaseErr.get(worst) ?? 0, phaseMoves.get(worst) ?? 0, phaseErr.get(best) ?? 0, phaseMoves.get(best) ?? 0);
      if (rb > 0 && rw / rb >= 1.6 && clear) {
        patterns.push(
          pattern(
            `phase_${worst}`,
            `Fehlerhäufung ${trPhaseIn(worst)}`,
            // Python's str.capitalize() would also lowercase the rest ("Im mittelspiel");
            // only the first letter is raised here so the German noun stays capitalized.
            `${upperFirst(trPhaseIn(worst))} machst du ${fmt(rw * 100, 1)} ` +
              `schwere Fehler pro 100 Züge – ${fmt(rw / rb, 1)}× so viele ` +
              `wie ${trPhaseIn(best)}.`,
            "mittel",
            rw,
            examples(analyzed, (m) => m.is_serious_error && m.phase === worst),
          ),
        );
      }
    }
  }

  patterns.push(...hungPiecePattern(analyzed));
  patterns.push(...sessionPatterns(feats));
  patterns.push(...opponentStrengthPattern(feats));
  patterns.push(...castlingPattern(feats));

  const order: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2, positiv: 3 };
  patterns.sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.value - a.value,
  );
  return patterns;
}

function hungPiecePattern(analyzed: GameFeatures[]): Pattern[] {
  const counts = new Map<string, number>();
  for (const f of analyzed) {
    const byPiece = ((f.rec.tactics_data ?? {}).hanging_metrics?.by_piece ?? {}) as Record<
      string,
      number
    >;
    for (const [p, c] of Object.entries(byPiece)) counts.set(p, (counts.get(p) ?? 0) + c);
  }
  const total = [...counts.values()].reduce((s, v) => s + v, 0);
  if (total < 10) return [];
  // Counter.most_common(1): highest count, first inserted wins ties.
  let piece = "";
  let cnt = -1;
  for (const [p, c] of counts) {
    if (c > cnt) {
      piece = p;
      cnt = c;
    }
  }
  const share = cnt / total;
  // Pawns and knights hang more often anyway; only a clear majority is a pattern.
  if (share < 0.35 || !shareAtLeast(cnt, total, 0.25)) return [];
  const exampleRefs: GameRef[] = [];
  for (const f of analyzed) {
    for (const h of ((f.rec.tactics_data ?? {}).hung_pieces_details ?? []) as Record<
      string,
      any
    >[]) {
      if (String(h.piece_name ?? "").toLowerCase() === piece) {
        exampleRefs.push({
          game_id: f.game_id,
          ply_index: Math.max(0, Math.trunc(Number(h.ply ?? 1)) - 1),
          label: `${h.san ?? ""} gegen ${f.rec.opp_name}`,
          detail: `${trPiece(piece)} eingestellt · ${f.date}`,
        });
        break;
      }
    }
    if (exampleRefs.length >= MAX_EXAMPLES) break;
  }
  return [
    pattern(
      "hung_piece_type",
      `Häufig eingestellt: ${trPiece(piece)}`,
      `${fmt(share * 100, 0)} % deiner eingestellten Figuren sind ${trPiece(piece, true)} ` +
        `(${cnt} von ${total}). Prüfe vor jedem Zug besonders, ob diese Figur gedeckt ist.`,
      severity(share, 0.5, 0.35),
      share,
      exampleRefs,
    ),
  ];
}

function sessions(feats: GameFeatures[]): GameFeatures[][] {
  const timed = feats
    .filter((f) => f.played_at)
    .sort((a, b) => (a.played_at || 0) - (b.played_at || 0));
  const out: GameFeatures[][] = [];
  for (const f of timed) {
    const last = out[out.length - 1];
    if (
      last &&
      (f.played_at || 0) - (last[last.length - 1].played_at || 0) <= SESSION_GAP_SECONDS
    ) {
      last.push(f);
    } else {
      out.push([f]);
    }
  }
  return out;
}

function sessionPatterns(feats: GameFeatures[]): Pattern[] {
  const out: Pattern[] = [];
  const sess = sessions(feats);

  // Tilt: results of the game right after a loss within the same session.
  const afterLoss: number[] = [];
  const others: number[] = [];
  const overall: number[] = [];
  for (const s of sess) {
    s.forEach((f, i) => {
      if (f.score === null) return;
      overall.push(f.score);
      if (i > 0 && s[i - 1].rec.is_loss) afterLoss.push(f.score);
      else others.push(f.score);
    });
  }
  // Compared with the other games, not with a total that contains them.
  const tiltClear =
    afterLoss.length >= MIN_GROUP_GAMES &&
    scoresDiffer({ games: afterLoss.length, score_pct: avg(afterLoss) * 100 }, { games: others.length, score_pct: others.length ? avg(others) * 100 : null });
  if (tiltClear && overall.length) {
    const base = avg(overall);
    const tilt = avg(afterLoss);
    if (base - tilt >= 0.08) {
      out.push(
        pattern(
          "tilt",
          "Tilt nach Niederlagen",
          `Direkt nach einer Niederlage holst du nur ${fmt(tilt * 100, 0)} % der Punkte ` +
            `(sonst ${fmt(base * 100, 0)} %). Nach einer Niederlage lohnt sich eine Pause, ` +
            "statt sofort die nächste Partie zu starten.",
          base - tilt >= 0.15 ? "hoch" : "mittel",
          base - tilt,
        ),
      );
    } else if (tilt >= base + 0.03) {
      out.push(
        pattern(
          "resilient",
          "Mental stabil nach Niederlagen",
          `Nach einer Niederlage spielst du sogar besser (${fmt(tilt * 100, 0)} % der ` +
            `Punkte gegenüber ${fmt(base * 100, 0)} % im Schnitt).`,
          "positiv",
          tilt - base,
        ),
      );
    }
  }

  // Fatigue: accuracy in long sessions (4th game onwards) vs the first games.
  const earlyAcc = sess.flatMap((s) => s.slice(0, 3).filter((f) => f.analyzed).map((f) => f.rec.game_acc));
  const lateAcc = sess.flatMap((s) => s.slice(3).filter((f) => f.analyzed).map((f) => f.rec.game_acc));
  if (meansDiffer(earlyAcc, lateAcc)) {
    const drop = avg(earlyAcc) - avg(lateAcc);
    if (drop >= 3) {
      out.push(
        pattern(
          "fatigue",
          "Nachlassen in langen Sessions",
          "Ab der 4. Partie einer Session sinkt deine Genauigkeit um " +
            `${fmt(drop, 1)} Prozentpunkte. Begrenze Sessions auf 3 Partien.`,
          "mittel",
          drop,
        ),
      );
    }
  }
  return out;
}

function opponentStrengthPattern(feats: GameFeatures[]): Pattern[] {
  const weaker: number[] = [];
  const expected: number[] = [];
  for (const f of feats) {
    if (f.score === null || !f.user_rating || !f.opp_rating) continue;
    if (f.opp_rating <= f.user_rating - 100) {
      weaker.push(f.score);
      expected.push(expectedScore(f.user_rating, f.opp_rating));
    }
  }
  if (weaker.length >= MIN_GROUP_GAMES) {
    const score = avg(weaker);
    // The real Elo expectation against exactly these opponents, not a fixed 64 %.
    const exp = avg(expected);
    const below = scoreDeviation({ games: weaker.length, score_pct: score * 100 }, exp * 100, undefined, MIN_GROUP_GAMES) < 0;
    if (exp - score >= 0.06 && below) {
      return [
        pattern(
          "weaker_opponents",
          "Punktverluste gegen schwächere Gegner",
          "Gegen Gegner mit mindestens 100 Punkten weniger holst du nur " +
            `${fmt(score * 100, 0)} % der Punkte (erwartet wären ${fmt(exp * 100, 0)} %). ` +
            "Unterschätze niemanden – spiele auch hier jeden Zug mit voller Sorgfalt.",
          "mittel",
          exp - score,
        ),
      ];
    }
  }
  return [];
}

function castlingPattern(feats: GameFeatures[]): Pattern[] {
  const late = feats.filter((f) => f.score !== null && f.plies >= 30 && f.castle_side === null);
  const onTime = feats.filter(
    (f) => f.score !== null && f.castle_move !== null && f.castle_move <= 10,
  );
  if (late.length >= MIN_GROUP_GAMES && onTime.length >= MIN_GROUP_GAMES) {
    const lateScore = avg(late.map((f) => f.score || 0));
    const okScore = avg(onTime.map((f) => f.score || 0));
    const clear = scoresDiffer({ games: late.length, score_pct: lateScore * 100 }, { games: onTime.length, score_pct: okScore * 100 });
    if (okScore - lateScore >= 0.12 && clear) {
      return [
        pattern(
          "king_safety",
          "Ohne Rochade schlechtere Ergebnisse",
          `In Partien ohne Rochade holst du ${fmt(lateScore * 100, 0)} % der Punkte, ` +
            `mit früher Rochade ${fmt(okScore * 100, 0)} %. Bring deinen König früher in ` +
            "Sicherheit.",
          "mittel",
          okScore - lateScore,
          late.slice(0, 6).map((f) => ref(f, null, `als ${trColor(f.rec.user_color)}`)),
        ),
      ];
    }
  }
  return [];
}
