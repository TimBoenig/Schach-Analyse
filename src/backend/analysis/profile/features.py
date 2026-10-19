"""
Per-game feature extraction for the player profile.

Turns a stored game (row dict with moves_json) into move-level events from the
tracked player's perspective: errors with their context (winning/losing,
time trouble, right after leaving the book), punished or missed opponent
errors, and style signals (checks, pawn storms, trades, castling).
"""

from __future__ import annotations

import datetime
import json
import re
from dataclasses import dataclass, field
from typing import Any

import chess

from src.backend.analysis.metrics.models import GameRecord
from src.backend.analysis.tactics.constants import (
    DEFAULT_TROUBLE_SECONDS,
    PIECE_VALUES,
    TROUBLE_SECONDS,
)
from src.backend.analysis.tactics.phase import classify_game_phase
from src.utils.logger import logger

ERROR_CLASSES: frozenset[str] = frozenset({"Inaccuracy", "Mistake", "Blunder", "Miss"})
SERIOUS_ERROR_CLASSES: frozenset[str] = frozenset({"Mistake", "Blunder", "Miss"})
GOOD_CLASSES: frozenset[str] = frozenset({"Brilliant", "Great", "Best", "Excellent"})

# A drop of 10 percentage points in winning chances is roughly where chess.com
# starts calling a move a mistake; below that we treat a reply as "kept the gain".
PUNISH_KEEP_THRESHOLD = 0.10
# Opponent moves losing >= 15 points of winning chance count as a chance to punish.
OPPONENT_ERROR_THRESHOLD = 0.15

_HEADER_RE = re.compile(r'\[(\w+)\s+"([^"]*)"\]')


def user_wp(white_wp: float | None, is_white: bool) -> float:
    """Convert a White-perspective win probability into the tracked player's perspective."""
    wp = 0.5 if white_wp is None else float(white_wp)
    return wp if is_white else 1.0 - wp


def san_for_uci(fen: str, uci: str | None, chess960: bool = False) -> str:
    """Render an engine UCI move as SAN for display; falls back to the raw UCI."""
    if not uci or not fen:
        return uci or ""
    try:
        board = chess.Board(fen, chess960=chess960)
        return board.san(chess.Move.from_uci(uci))
    except (ValueError, AssertionError):
        return uci


def move_label(move_number: int, is_white_move: bool, san: str) -> str:
    return f"{move_number}. {san}" if is_white_move else f"{move_number}... {san}"


def parse_played_at(game: dict[str, Any]) -> float | None:
    """
    Best-effort start time of the game as a UTC epoch.

    The DB 'timestamp' column is the save time, not the play time, so session
    and trend analysis must use the PGN UTCDate/UTCTime headers instead.
    """
    headers = dict(_HEADER_RE.findall(game.get("pgn") or "")[:40])
    date_str = headers.get("UTCDate") or game.get("date") or headers.get("Date") or ""
    time_str = headers.get("UTCTime") or headers.get("StartTime") or "12:00:00"
    date_str = date_str.replace("-", ".")
    if not re.match(r"^\d{4}\.\d{2}\.\d{2}$", date_str):
        return None
    try:
        dt = datetime.datetime.strptime(f"{date_str} {time_str[:8]}", "%Y.%m.%d %H:%M:%S")
    except ValueError:
        try:
            dt = datetime.datetime.strptime(date_str, "%Y.%m.%d")
        except ValueError:
            return None
    return dt.replace(tzinfo=datetime.timezone.utc).timestamp()


def _int_or_zero(val: Any) -> int:
    try:
        return int(str(val).strip())
    except (ValueError, TypeError):
        return 0


@dataclass
class MoveEvent:
    """One analyzed move by the tracked player."""

    ply_index: int
    move_number: int
    san: str
    uci: str
    fen_before: str
    classification: str
    phase: str
    wp_before: float
    wp_after: float
    best_move_uci: str | None
    time_spent: float | None
    time_left: float | None
    is_book: bool
    after_opponent_error: bool
    in_time_trouble: bool
    moves_since_book: int  # user moves since leaving theory (0 = first non-book move)

    @property
    def wp_drop(self) -> float:
        return max(0.0, self.wp_before - self.wp_after)

    @property
    def is_error(self) -> bool:
        return self.classification in ERROR_CLASSES

    @property
    def is_serious_error(self) -> bool:
        return self.classification in SERIOUS_ERROR_CLASSES


@dataclass
class GameFeatures:
    rec: GameRecord
    game_id: str
    played_at: float | None
    date: str
    user_rating: int
    opp_rating: int
    chess960: bool
    plies: int
    moves: list[MoveEvent] = field(default_factory=list)
    checks: int = 0
    captures: int = 0
    equal_trades: int = 0
    pawn_storm_moves: int = 0
    castle_side: str | None = None
    castle_move: int | None = None
    early_queen: bool = False
    queens_off_by_move: int | None = None
    punish_chances: int = 0
    punished: int = 0
    reached_endgame: bool = False
    end_clock_fraction: float | None = None  # clock left at the end / clock at start
    wp_volatility: float = 0.0

    @property
    def analyzed(self) -> bool:
        return self.rec.game_acc > 0 and any(m.classification for m in self.moves)

    @property
    def user_move_count(self) -> int:
        return len(self.moves)

    @property
    def score(self) -> float | None:
        """1 for a win, 0.5 for a draw, 0 for a loss, None if unfinished."""
        if self.rec.is_win:
            return 1.0
        if self.rec.is_draw:
            return 0.5
        if self.rec.is_loss:
            return 0.0
        return None

    def errors(self, serious_only: bool = False) -> list[MoveEvent]:
        if serious_only:
            return [m for m in self.moves if m.is_serious_error]
        return [m for m in self.moves if m.is_error]


def _trouble_threshold(speed: str) -> float:
    cat = (speed or "").lower()
    for key, seconds in TROUBLE_SECONDS.items():
        if key in cat:
            return seconds
    return DEFAULT_TROUBLE_SECONDS


def _load_moves(game: dict[str, Any]) -> list[dict[str, Any]]:
    raw = game.get("moves_json")
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def extract_features(
    game: dict[str, Any],
    user_color: str,
    rec: GameRecord | None = None,
) -> GameFeatures:
    """Build GameFeatures for one stored game row from the tracked player's perspective."""
    rec = rec or GameRecord.from_dict(game, user_color)
    is_white = user_color == "white"
    chess960 = bool(game.get("chess960", 0))
    user_elo_key = "white_elo" if is_white else "black_elo"
    opp_elo_key = "black_elo" if is_white else "white_elo"

    feats = GameFeatures(
        rec=rec,
        game_id=str(game.get("id") or ""),
        played_at=parse_played_at(game),
        date=str(game.get("date") or ""),
        user_rating=_int_or_zero(game.get(user_elo_key)),
        opp_rating=_int_or_zero(game.get(opp_elo_key)),
        chess960=chess960,
        plies=0,
    )

    moves = _load_moves(game)
    feats.plies = len(moves)
    if not moves:
        return feats

    trouble = _trouble_threshold(rec.speed)
    start_clock: float | None = None
    last_clock: float | None = None
    prev_opp_drop = 0.0
    user_moves_seen = 0
    book_exit_user_move: int | None = None
    wp_changes: list[float] = []

    for idx, md in enumerate(moves):
        fen = md.get("fen_before") or ""
        try:
            board = chess.Board(fen, chess960=chess960) if fen else chess.Board()
        except ValueError:
            logger.debug("Skipping move with invalid FEN in game %s", feats.game_id)
            continue

        mover_is_white = board.turn == chess.WHITE
        wp_b = user_wp(md.get("win_chance_before"), is_white)
        wp_a = user_wp(md.get("win_chance_after"), is_white)
        wp_changes.append(abs(wp_a - wp_b))

        queens_off = not board.pieces(chess.QUEEN, chess.WHITE) and not board.pieces(
            chess.QUEEN, chess.BLACK
        )
        if feats.queens_off_by_move is None and queens_off:
            feats.queens_off_by_move = int(md.get("move_number") or (idx // 2 + 1))

        if mover_is_white != is_white:
            # Opponent move: remember how much it cost them (= our chance to punish).
            prev_opp_drop = max(0.0, wp_a - wp_b)
            continue

        is_book = bool(md.get("is_book_move", False))
        phase = classify_game_phase(board, idx, is_book_move=is_book)
        if phase == "endgame":
            feats.reached_endgame = True
        if not is_book and book_exit_user_move is None:
            book_exit_user_move = user_moves_seen

        move_obj: chess.Move | None = None
        uci = md.get("uci") or ""
        try:
            move_obj = chess.Move.from_uci(uci) if uci else board.parse_san(md.get("san", ""))
        except ValueError:
            move_obj = None

        if move_obj is not None and move_obj in board.legal_moves:
            _record_style(board, move_obj, user_moves_seen, feats, is_white)

        time_left = md.get("time_left")
        if time_left is not None:
            if start_clock is None:
                spent = md.get("time_spent") or 0.0
                start_clock = float(time_left) + float(spent)
            last_clock = float(time_left)

        after_opp_error = prev_opp_drop >= OPPONENT_ERROR_THRESHOLD
        classification = md.get("classification") or ""
        if after_opp_error and classification:
            feats.punish_chances += 1
            if max(0.0, wp_b - wp_a) < PUNISH_KEEP_THRESHOLD:
                feats.punished += 1

        feats.moves.append(
            MoveEvent(
                ply_index=idx,
                move_number=int(md.get("move_number") or (idx // 2 + 1)),
                san=md.get("san", ""),
                uci=uci,
                fen_before=fen,
                classification=classification,
                phase=phase,
                wp_before=wp_b,
                wp_after=wp_a,
                best_move_uci=md.get("best_move"),
                time_spent=md.get("time_spent"),
                time_left=time_left,
                is_book=is_book,
                after_opponent_error=after_opp_error,
                in_time_trouble=time_left is not None and float(time_left) <= trouble,
                moves_since_book=(
                    -1 if book_exit_user_move is None else user_moves_seen - book_exit_user_move
                ),
            )
        )
        user_moves_seen += 1
        prev_opp_drop = 0.0

    if start_clock and last_clock is not None and start_clock > 0:
        feats.end_clock_fraction = max(0.0, min(1.0, last_clock / start_clock))
    if wp_changes:
        feats.wp_volatility = sum(wp_changes) / len(wp_changes)
    return feats


def _record_style(
    board: chess.Board,
    move: chess.Move,
    user_move_index: int,
    feats: GameFeatures,
    is_white: bool,
) -> None:
    """Collect cheap style signals for one of the player's moves."""
    piece = board.piece_at(move.from_square)
    if piece is None:
        return

    if board.is_castling(move):
        if feats.castle_side is None:
            feats.castle_side = "kingside" if board.is_kingside_castling(move) else "queenside"
            feats.castle_move = user_move_index + 1
        return

    if board.gives_check(move):
        feats.checks += 1

    if board.is_capture(move):
        feats.captures += 1
        victim = board.piece_at(move.to_square)
        if victim is not None and PIECE_VALUES[victim.piece_type] == PIECE_VALUES[piece.piece_type]:
            feats.equal_trades += 1

    if piece.piece_type == chess.QUEEN and user_move_index < 6 and not board.is_capture(move):
        feats.early_queen = True

    if piece.piece_type == chess.PAWN:
        enemy_king = board.king(not board.turn)
        if enemy_king is not None:
            to_rank = chess.square_rank(move.to_square)
            rel_rank = to_rank if is_white else 7 - to_rank
            file_gap = abs(chess.square_file(move.to_square) - chess.square_file(enemy_king))
            # Pawns pushed to the 4th rank or beyond next to the enemy king = pawn storm.
            if rel_rank >= 3 and file_gap <= 1 and user_move_index >= 5:
                feats.pawn_storm_moves += 1
