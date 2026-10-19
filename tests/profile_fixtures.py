"""
Synthetic analyzed games for player-profile and game-review tests.

Games follow a fixed legal line; tests inject classifications and
White-perspective win chances per ply to model errors without Stockfish.
"""

from __future__ import annotations

import json
from typing import Any

import chess

from src.backend.storage.models import GameAnalysis, GameMetadata, MoveAnalysis

LINE = [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bc4",
    "Bc5",
    "c3",
    "Nf6",
    "d4",
    "exd4",
    "cxd4",
    "Bb4+",
    "Nc3",
    "Nxe4",
    "O-O",
    "Bxc3",
    "d5",
    "Bf6",
    "Re1",
    "Ne7",
    "Rxe4",
    "d6",
    "Bg5",
    "Bxg5",
    "Nxg5",
    "h6",
]


def build_moves(events: dict[int, tuple[str, float]] | None = None) -> list[dict[str, Any]]:
    """
    Build move dicts for LINE. `events` maps ply index -> (classification,
    White-perspective win chance AFTER that move); win chance otherwise stays put.
    """
    events = events or {}
    board = chess.Board()
    wp = 0.5
    moves: list[dict[str, Any]] = []
    for idx, san in enumerate(LINE):
        move = board.parse_san(san)
        legal_alt = next(m for m in board.legal_moves if m != move)
        cls, wp_after = events.get(idx, ("Best", wp))
        moves.append(
            MoveAnalysis(
                move_number=idx // 2 + 1,
                ply=idx + 1,
                san=san,
                uci=move.uci(),
                fen_before=board.fen(),
                best_move=move.uci() if cls == "Best" else legal_alt.uci(),
                win_chance_before=wp,
                win_chance_after=wp_after,
                eval_before_cp=int((wp - 0.5) * 1200),
                eval_after_cp=int((wp_after - 0.5) * 1200),
                classification=cls,
                time_spent=5.0,
                time_left=300.0 - idx * 5,
            ).to_dict()
        )
        board.push(move)
        wp = wp_after
    return moves


def game_row(
    game_id: str,
    moves: list[dict[str, Any]],
    user_white: bool = True,
    result: str = "1-0",
    accuracy: float = 80.0,
    utc: str = "2026.06.01 18:00:00",
    opening: str = "Italian Game",
    user: str = "Tim",
) -> dict[str, Any]:
    date, time_ = utc.split(" ")
    white, black = (user, "Gegner") if user_white else ("Gegner", user)
    counts: dict[str, dict[str, Any]] = {
        "white": {"accuracy": accuracy},
        "black": {"accuracy": accuracy},
    }
    for i, m in enumerate(moves):
        side = counts["white" if i % 2 == 0 else "black"]
        side[m["classification"]] = side.get(m["classification"], 0) + 1
    pgn = (
        f'[White "{white}"]\n[Black "{black}"]\n[Result "{result}"]\n'
        f'[UTCDate "{date}"]\n[UTCTime "{time_}"]\n\n{" ".join(LINE)} {result}'
    )
    return {
        "id": game_id,
        "white": white,
        "black": black,
        "result": result,
        "date": date,
        "white_elo": "1500",
        "black_elo": "1500",
        "speed_category": "Rapid",
        "opening": opening,
        "eco": "C54",
        "source": "chesscom",
        "chess960": 0,
        "pgn": pgn,
        "moves_json": json.dumps(moves),
        "summary_json": json.dumps({**counts, "analysis_status": "completed"}),
    }


def game_analysis(
    moves: list[dict[str, Any]], result: str = "0-1", user_white: bool = True
) -> GameAnalysis:
    white, black = ("Tim", "Gegner") if user_white else ("Gegner", "Tim")
    return GameAnalysis(
        game_id="review-game",
        metadata=GameMetadata(white=white, black=black, result=result, speed_category="Rapid"),
        moves=[MoveAnalysis.from_dict(m) for m in moves],
        summary={"white": {"accuracy": 70.0}, "black": {"accuracy": 85.0}},
    )
