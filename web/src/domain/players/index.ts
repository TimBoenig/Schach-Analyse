// Other players: tracked opponents and friends, scouting reports and the friends ranking.
export * from "./models";
export { buildMatchup, probBetter } from "./compare";
export type { Edge, Estimate, Matchup, MatchupRow, Prediction } from "./compare";
export { qualityGames, speedFairness } from "./fairness";
export type { QualityGame, SpeedAdjust, SpeedFairness } from "./fairness";
export { frequentOpponents, headToHead, mainSource } from "./h2h";
export type { FrequentOpponent, H2HGame, HeadToHead } from "./h2h";
export { buildRanking, RANK_FACTORS } from "./ranking";
export type { FactorGroup, RankCell, RankContribution, RankFactor, RankInput, Ranking, RankRow } from "./ranking";
export { buildScoutReport, MIN_LINE_GAMES, ratingLabel } from "./scout";
export type { OpeningPick, ScoutReport, ScoutTip, SkillCompare, TipKind } from "./scout";
export { FORM_DAYS, FORM_MIN_GAMES, groupForm, groupStanding, sharedOpenings } from "./group";
export type { FormRow, GroupPoint, GroupStanding, SharedOpening } from "./group";
export { BATTLE_ROUNDS, buildBattle, chase, crowns, rivalOf, ROUND_P } from "./battle";
export type { Battle, BattleFactor, BattleRound, Chase, Crown, RoundDef, Side } from "./battle";
export { FACTOR_WEIGHTS, SKILL_FACTORS } from "./weights";
