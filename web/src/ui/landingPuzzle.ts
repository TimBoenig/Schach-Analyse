// The landing page's mini puzzle, kept apart from the view so a test can prove
// it really is a mate in one with exactly one solution.
/** Back-rank mate in one (Rd8#): small enough to read on a phone, satisfying to find. */
export const PUZZLE_FEN = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
/** The arrow shown after two misses. */
export const PUZZLE_HINT = { from: "d1", to: "d8" } as const;
