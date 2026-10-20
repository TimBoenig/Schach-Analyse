import { describe, expect, it } from "vitest";
import {
  analyzeGameTactics,
  Board,
  BLACK,
  classifyGamePhase,
  detectTacticalMotifs,
  getHangingPieces,
  moveFromUci,
  STARTING_FEN,
  WHITE,
} from "../../src/domain/tactics";

function hangingSquares(fen: string, color: boolean): string[] {
  return getHangingPieces(new Board(fen), color).map((h) => h.square);
}

function afterMove(fen: string, uci: string) {
  const before = new Board(fen);
  const move = moveFromUci(uci);
  const after = before.copy();
  after.push(move);
  return { before, after, move };
}

describe("hanging piece detection", () => {
  it("flags an undefended attacked pawn", () => {
    // 1. e4 e5 2. Nf3: Nf3 attacks the undefended e5 pawn
    const hanging = getHangingPieces(
      new Board("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"),
      BLACK,
    );
    const e5 = hanging.find((h) => h.square === "e5");
    expect(e5).toMatchObject({ is_undefended: true, piece_name: "pawn" });
  });

  it("flags a defended queen attacked by a lesser bishop", () => {
    const hanging = getHangingPieces(
      new Board("rn1qk1nr/ppp1bppp/1b6/8/3q4/2P5/PP2PPPP/RNB1KBNR w KQkq - 0 5"),
      BLACK,
    );
    expect(hanging.find((h) => h.square === "d4")).toMatchObject({
      attacked_by_lesser: true,
      piece_name: "queen",
    });
  });

  it.each([
    // Knight on d4 defended by c3, attacked by an equal-value knight
    ["r1bqkb1r/pppp1ppp/2n5/8/3N4/2P5/PPP1PPPP/R1BQKB1R w KQkq - 1 5", "d4"],
    // Pawn on e4 defended by d3, only attacked by higher-value pieces
    ["r1bqk2r/pppp1ppp/2n2n2/2b5/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 5", "e4"],
  ])("does not flag adequately defended pieces (%s)", (fen, sq) => {
    expect(hangingSquares(fen, WHITE)).not.toContain(sq);
  });

  it("never marks the king as hanging", () => {
    expect(getHangingPieces(new Board("4q3/8/8/8/8/8/8/4K3 w - - 0 1"), WHITE)).toHaveLength(0);
  });

  it("ignores a defender pinned to its king", () => {
    // g2 pawn is pinned on the long diagonal by Bb7 and cannot defend h3
    expect(hangingSquares("7q/1b6/8/8/8/7N/6P1/7K w - - 0 1", WHITE)).toContain("h3");
  });
});

describe("classifyGamePhase", () => {
  it.each([
    [STARTING_FEN, 4, true, "opening"],
    [STARTING_FEN, 10, false, "opening"],
    ["8/4k3/8/8/8/4K3/4R3/4r3 w - - 0 1", 50, false, "endgame"],
    ["r1bq1rk1/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 4 8", 22, false, "middlegame"],
  ])("classifies %s at ply %i", (fen, ply, book, expected) => {
    expect(classifyGamePhase(new Board(fen), ply, book)).toBe(expected);
  });
});

describe("detectTacticalMotifs", () => {
  it.each([
    // Knight fork on c7 hitting king e8 and rook a8
    ["r3k2r/pppb1ppp/8/4N3/1b2P3/8/PPP2PPP/R1B1KB1R w KQkq - 1 10", "e5c7", "fork"],
    // Bb5 pins Nc6 to the king on e8
    ["r1bqkbnr/pp2pppp/2n5/3p4/4P3/8/PPPPBPPP/RNBQK1NR w KQkq - 0 4", "e2b5", "pin"],
    // Knight leaves the e-file, unmasking a rook check
    ["4k3/8/8/8/4N3/8/8/4R2K w - - 0 1", "e4f6", "discovered_attack"],
  ])("detects motif in %s after %s", (fen, uci, motif) => {
    const { before, after, move } = afterMove(fen, uci);
    expect(detectTacticalMotifs(before, after, move, WHITE)).toContain(motif);
  });
});

describe("analyzeGameTactics", () => {
  it("tracks advantage conversion, brilliancies and phase accuracy", () => {
    const tactics = analyzeGameTactics(
      [
        {
          ply: 1, move_number: 1, san: "e4", uci: "e2e4", fen_before: STARTING_FEN,
          eval_before_cp: 20, win_chance_before: 0.52, win_chance_after: 0.53,
          classification: "Best", is_book_move: true,
        },
        {
          ply: 2, move_number: 1, san: "e5", uci: "e7e5",
          fen_before: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
          eval_before_cp: 20, win_chance_before: 0.47, win_chance_after: 0.48,
          classification: "Best", is_book_move: true,
        },
        {
          ply: 3, move_number: 2, san: "Qh5", uci: "d1h5",
          fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2",
          eval_before_cp: 350, win_chance_before: 0.85, win_chance_after: 0.88,
          classification: "Brilliant", explanation: "Sacrificial tactical strike", is_book_move: false,
        },
      ],
      "white",
      "1-0",
    );
    expect(tactics.advantage_metrics).toMatchObject({
      had_winning_advantage: true,
      converted_advantage: true,
      choked_advantage: false,
      thrown_losses: false,
      squandered_draws: false,
      had_losing_position: false,
      comeback_drawn_or_won: false,
    });
    expect(tactics.brilliancies).toHaveLength(1);
    expect(tactics.brilliancies[0]).toMatchObject({ san: "Qh5", classification: "Brilliant" });
    expect(tactics.phase_accuracies.opening).not.toBeNull();
  });

  it.each([
    // White was +4 but lost: thrown loss
    [400, 0.9, "0-1", { had_winning_advantage: true, converted_advantage: false, choked_advantage: true, thrown_losses: true, squandered_draws: false }],
    // White was -4.5 but won: comeback win
    [-450, 0.05, "1-0", { had_losing_position: true, comeback_drawn_or_won: true, comeback_wins: true, comeback_draws: false, lost_deficit: false }],
  ])("advantage metrics for eval %i result %s", (cp, wp, result, expected) => {
    const tactics = analyzeGameTactics(
      [{ ply: 0, san: "e4", fen_before: STARTING_FEN, eval_before_cp: cp, win_chance_before: wp, win_chance_after: wp, classification: "Best", is_book_move: false }],
      "white",
      result,
    );
    expect(tactics.advantage_metrics).toMatchObject(expected);
  });

  it("never counts sound sacrifices as hung pieces", () => {
    const tactics = analyzeGameTactics(
      [{
        ply: 1, move_number: 1, san: "Bxh7+", uci: "d3h7",
        fen_before: "r1bq1rk1/pppp1ppp/2n5/4p3/4P3/3B4/PPP2PPP/RNBQK2R w KQ - 0 6",
        eval_before_cp: 250, win_chance_before: 0.75, win_chance_after: 0.85,
        classification: "Brilliant", is_book_move: false,
      }],
      "white",
      "1-0",
    );
    expect(tactics.hanging_metrics.total_hung).toBe(0);
    expect(tactics.hanging_metrics.hanging_blunders).toBe(0);
  });

  it("counts a sound capture of an undefended piece, but not of a defended one", () => {
    const notHanging = analyzeGameTactics(
      [{
        ply: 1, move_number: 1, san: "Qxf7+", uci: "d1f7",
        fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
        eval_before_cp: 50, win_chance_before: 0.55, win_chance_after: 0.65,
        classification: "Best", is_book_move: false,
      }],
      "white",
      "1-0",
    );
    expect(notHanging.hanging_metrics.opponent_hanging_captured).toBe(0);

    const captured = analyzeGameTactics(
      [{
        ply: 1, move_number: 1, san: "Nxe5", uci: "f3e5",
        fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2",
        eval_before_cp: 100, win_chance_before: 0.6, win_chance_after: 0.65,
        classification: "Best", is_book_move: false,
      }],
      "white",
      "1-0",
    );
    expect(captured.hanging_metrics.opponent_hanging_captured).toBe(1);
    expect(captured.hanging_metrics.captured_by_piece.pawn).toBe(1);
  });

  it("populates blunder and hung-piece drill-down details", () => {
    const tactics = analyzeGameTactics(
      [
        {
          ply: 1, move_number: 1, san: "Ba6", uci: "f1a6", fen_before: STARTING_FEN,
          eval_before_cp: 50, eval_after_cp: -200, win_chance_before: 0.55, win_chance_after: 0.3,
          classification: "Blunder", is_book_move: false,
        },
        {
          ply: 2, move_number: 1, san: "e5", uci: "e7e5",
          fen_before: "rnbqkbnr/pppppppp/B7/8/8/8/PPPPPPPP/RNBQK1NR b KQkq - 1 1",
          eval_before_cp: -200, win_chance_before: 0.3, win_chance_after: 0.3,
          classification: "Best", is_book_move: false,
        },
      ],
      "white",
      "0-1",
    );
    expect(tactics.blunders_details).toHaveLength(1);
    expect(tactics.blunders_details[0]).toMatchObject({
      san: "Ba6", ply: 1, eval_before_cp: 50, eval_after_cp: -200, eval_drop: 250, wp_drop: 0.25,
    });
    expect(tactics.hung_pieces_details).toHaveLength(1);
    expect(tactics.hung_pieces_details[0]).toMatchObject({
      piece_name: "bishop", square: "a6", ply: 1, san: "Ba6",
    });
  });

  it("does not treat a routine exchange as hanging or capitalized", () => {
    const start = "r1bqk2r/ppp1bppp/8/3n4/8/2N2N2/PPPPQPPP/R1B1KB1R b KQkq - 1 5";
    const { after: afterBlack } = afterMove(start, "d5c3");
    const afterWhite = afterBlack.copy();
    afterWhite.push(moveFromUci("b2c3"));
    const moves = [
      { ply: 10, move_number: 5, san: "Nxc3", uci: "d5c3", fen_before: new Board(start).fen(), fen_after: afterBlack.fen(), classification: "Best" as const, is_book_move: false },
      { ply: 11, move_number: 6, san: "bxc3", uci: "b2c3", fen_before: afterBlack.fen(), fen_after: afterWhite.fen(), classification: "Best" as const, is_book_move: false },
    ];

    const white = analyzeGameTactics(moves, "white", "1-0");
    expect(white.hanging_metrics.opponent_hanging_captured).toBe(0);
    expect(white.opp_captured_details).toHaveLength(0);
    expect(white.hanging_metrics.total_hung).toBe(0);
    expect(white.hung_pieces_details).toHaveLength(0);

    const black = analyzeGameTactics(moves, "black", "0-1");
    expect(black.hanging_metrics.total_hung).toBe(0);
    expect(black.hung_pieces_details).toHaveLength(0);
  });
});

describe("Board (python-chess parity)", () => {
  it("round-trips FEN and drops the en-passant square when no capture is legal", () => {
    const b = new Board();
    b.push(moveFromUci("e2e4"));
    expect(b.fen()).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  });

  it("generates SAN with disambiguation, castling and mate", () => {
    const castle = new Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(castle.san(moveFromUci("e1g1"))).toBe("O-O");
    const rooks = new Board("4k3/8/8/8/8/8/8/R4RK1 w - - 0 1");
    expect(rooks.san(moveFromUci("a1d1"))).toBe("Rad1");
    const mate = new Board("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    expect(mate.san(moveFromUci("a1a8"))).toBe("Ra8#");
    expect(mate.parseSan("Ra8")).toEqual(moveFromUci("a1a8"));
  });
});
