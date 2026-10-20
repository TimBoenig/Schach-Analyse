// Playing style estimation from move-level style signals
// (port of src/backend/analysis/profile/style.py).

import type { GameFeatures } from "./features";
import type { SkillScore, StyleAxis, StyleProfile } from "./models";
import { avg, fmt, pyRound } from "./num";
import { scale } from "./skills";

const axis = (
  key: string,
  name: string,
  value: number,
  low_label: string,
  high_label: string,
): StyleAxis => ({ key, name, value, low_label, high_label });

const themesOf = (f: GameFeatures): Record<string, number> =>
  ((f.rec.tactics_data ?? {}).tactical_themes ?? {}) as Record<string, number>;

export function buildStyle(feats: GameFeatures[], skills: SkillScore[]): StyleProfile | null {
  const games = feats.filter((f) => f.user_move_count >= 10);
  if (games.length < 3) return null;

  const moves = games.reduce((s, f) => s + f.user_move_count, 0);
  const checksPm = games.reduce((s, f) => s + f.checks, 0) / moves;
  const stormsPg = avg(games.map((f) => f.pawn_storm_moves));
  const sacsPg = avg(games.map((f) => Number(themesOf(f).sacrifice ?? 0)));
  const motifsPg = avg(
    games.map((f) => Object.values(themesOf(f)).reduce((s, v) => s + Number(v), 0)),
  );
  const tradesPg = avg(games.map((f) => f.equal_trades));
  const earlyQueenTrade = avg(
    games.map((f) => (f.queens_off_by_move !== null && f.queens_off_by_move <= 20 ? 1 : 0)),
  );
  const finished = games.filter((f) => f.score !== null);
  const drawRate = avg(finished.map((f) => (f.rec.is_draw ? 1 : 0)));
  const volatility = avg(games.map((f) => f.wp_volatility));
  const endgameRate = avg(games.map((f) => (f.reached_endgame ? 1 : 0)));
  const clockFracs = games
    .map((f) => f.end_clock_fraction)
    .filter((c): c is number => c !== null);

  const aggression = pyRound(
    0.5 * scale(checksPm, 0.03, 0.14) + 0.3 * scale(stormsPg, 0, 3) + 0.2 * scale(sacsPg, 0, 0.4),
    1,
  );
  const tactical = scale(motifsPg, 0.2, 2.0);
  const trading = pyRound(
    0.6 * scale(tradesPg, 2.0, 6.0) + 0.4 * scale(earlyQueenTrade, 0.1, 0.5),
    1,
  );
  const risk = pyRound(
    0.5 * scale(1 - drawRate, 0.8, 0.98) + 0.5 * scale(volatility, 0.03, 0.09),
    1,
  );
  const endgame = scale(endgameRate, 0.2, 0.7);

  const axes = [
    axis("aggression", "Angriffslust", aggression, "abwartend", "angriffslustig"),
    axis("tactical", "Taktik-Orientierung", tactical, "positionell", "taktisch"),
    axis("trading", "Tauschfreude", trading, "hält Spannung", "tauscht gern"),
    axis("risk", "Risikobereitschaft", risk, "sicherheitsorientiert", "riskant"),
    axis("endgame", "Endspielneigung", endgame, "Entscheidung früh", "spielt lange"),
  ];
  if (clockFracs.length) {
    axes.push(
      axis("tempo", "Zeitverbrauch", scale(1 - avg(clockFracs), 0.2, 0.9), "zügig", "gründlich"),
    );
  }

  const skillMap = new Map(skills.map((s) => [s.key, s]));
  const [label, description] = styleLabel(aggression, tactical, trading, risk, endgame, skillMap);

  const facts = [
    `${fmt(checksPm * 40, 1)} Schachgebote pro 40 Züge`,
    `${fmt(tradesPg, 1)} gleichwertige Abtausche pro Partie`,
    `Damentausch bis Zug 20 in ${fmt(earlyQueenTrade * 100, 0)} % der Partien`,
    `Endspiel erreicht in ${fmt(endgameRate * 100, 0)} % der Partien`,
    `Remisquote ${fmt(drawRate * 100, 0)} %`,
  ];
  const castled = games.filter((f) => f.castle_side);
  if (castled.length) {
    const short = castled.filter((f) => f.castle_side === "kingside").length / castled.length;
    facts.push(
      `Rochade in ${fmt((castled.length / games.length) * 100, 0)} % der Partien ` +
        `(${fmt(short * 100, 0)} % kurz), im Schnitt im ` +
        `${fmt(avg(castled.map((f) => f.castle_move ?? 0)), 0)}. Zug`,
    );
  }
  return { label, description, axes, facts };
}

function styleLabel(
  aggression: number,
  tactical: number,
  trading: number,
  risk: number,
  endgame: number,
  skill: Map<string, SkillScore>,
): [string, string] {
  const egSkill = skill.get("endgame");
  const defSkill = skill.get("defense");
  if (aggression >= 60 && tactical >= 50) {
    return [
      "Angriffsspieler",
      "Du suchst die Initiative: viele Schachgebote, Bauernstürme und taktische Motive. " +
        "Deine Partien werden scharf entschieden. Achte darauf, dass dein eigener König und " +
        "deine Figuren dabei sicher bleiben.",
    ];
  }
  if (tactical >= 60) {
    return [
      "Taktiker",
      "Du lebst von konkreten Varianten und taktischen Schlägen. Ruhige, strategische " +
        "Stellungen ohne direkte Ziele sind eher Neuland – dort lohnt sich Planungstraining.",
    ];
  }
  if (endgame >= 60 && egSkill !== undefined && egSkill.score >= 55) {
    return [
      "Endspieltechniker",
      "Du spielst Partien gern lange und bist im Endspiel sicher unterwegs. Vereinfachen, " +
        "wenn du besser stehst, ist für dich eine gute Strategie.",
    ];
  }
  if (trading >= 60 && risk < 50) {
    return [
      "Solider Positionsspieler",
      "Du tauschst gern ab und vermeidest unnötige Risiken. Das macht dich schwer zu " +
        "schlagen; gegen schwächere Gegner fehlt manchmal der Druck, um zu gewinnen.",
    ];
  }
  if (defSkill !== undefined && defSkill.reliable && defSkill.score >= 60) {
    return [
      "Kämpfer",
      "Auch in schlechteren Stellungen gibst du nicht auf und rettest überdurchschnittlich " +
        "oft noch Punkte.",
    ];
  }
  if (risk >= 65) {
    return [
      "Risikospieler",
      "Deine Partien schwanken stark – du gehst Risiken ein und Remis sind selten. " +
        "Mehr Stabilität in kritischen Momenten bringt dir schnell Punkte.",
    ];
  }
  return [
    "Universalspieler",
    "Dein Stil ist ausgewogen: weder ausgesprochen aggressiv noch übervorsichtig. " +
      "Die Profilwerte unten zeigen, wo du dich gezielt weiterentwickeln kannst.",
  ];
}
