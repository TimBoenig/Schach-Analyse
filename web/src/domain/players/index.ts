// Other players: tracked opponents and friends, scouting reports and the friends ranking.
export * from "./models";
export { buildMatchup, probBetter } from "./compare";
export type { Edge, Estimate, Matchup, MatchupRow, Prediction } from "./compare";
export { frequentOpponents, headToHead, mainSource } from "./h2h";
export type { FrequentOpponent, H2HGame, HeadToHead } from "./h2h";
export { buildRanking, RANK_FACTORS } from "./ranking";
export type { FactorGroup, RankCell, RankFactor, RankInput, Ranking, RankRow } from "./ranking";
export { buildScoutReport, MIN_LINE_GAMES, ratingLabel } from "./scout";
export type { OpeningPick, ScoutReport, ScoutTip, SkillCompare, TipKind } from "./scout";
