"""
Tests for the player profile (skills, patterns, puzzles) and the game review.
"""

import chess
import pytest

from src.backend.analysis.profile import (
    build_game_review,
    build_player_profile,
    extract_features,
    school_grade,
)
from src.backend.analysis.profile.skills import SKILL_NAMES
from tests.profile_fixtures import build_moves, game_analysis, game_row

# Opponent (Black) blunders at ply 15 -> White winning; user (White) throws it away at ply 16.
THROWN_WIN = {15: ("Blunder", 0.85), 16: ("Blunder", 0.25)}
# Opponent blunders at ply 15 and the user keeps the advantage.
PUNISHED = {15: ("Blunder", 0.85), 16: ("Best", 0.86)}


def _games(n_thrown: int, n_clean: int) -> list[dict]:
    rows = []
    for i in range(n_thrown):
        rows.append(
            game_row(
                f"t{i}", build_moves(THROWN_WIN), result="0-1", utc=f"2026.05.{i + 1:02d} 18:00:00"
            )
        )
    for i in range(n_clean):
        rows.append(
            game_row(
                f"c{i}", build_moves(PUNISHED), result="1-0", utc=f"2026.06.{i + 1:02d} 18:00:00"
            )
        )
    return rows


def test_features_use_player_perspective_for_black():
    """A Black error must show up as a drop in *Black's* winning chance."""
    moves = build_moves({17: ("Blunder", 0.9)})  # Black's 9th move hands White the game
    feats = extract_features(game_row("b", moves, user_white=False, result="1-0"), "black")
    err = next(m for m in feats.moves if m.classification == "Blunder")
    assert err.ply_index == 17
    assert err.wp_before == pytest.approx(0.5)
    assert err.wp_after == pytest.approx(0.1)
    assert all(m.ply_index % 2 == 1 for m in feats.moves)


def test_punish_tracking_distinguishes_kept_and_thrown_advantage():
    kept = extract_features(game_row("k", build_moves(PUNISHED)), "white")
    thrown = extract_features(game_row("t", build_moves(THROWN_WIN)), "white")
    assert (kept.punish_chances, kept.punished) == (1, 1)
    assert (thrown.punish_chances, thrown.punished) == (1, 0)
    assert thrown.moves[8].after_opponent_error  # ply 16 is White's 9th move


def test_profile_detects_skills_patterns_and_puzzles():
    profile = build_player_profile(_games(n_thrown=9, n_clean=3), ["tim"])

    assert profile.total_games == profile.analyzed_games == 12
    assert {s.key for s in profile.skills} == set(SKILL_NAMES)
    assert all(0.0 <= s.score <= 100.0 for s in profile.skills)
    assert not {i.key for i in profile.strengths} & {i.key for i in profile.weaknesses}

    keys = {p.key for p in profile.patterns}
    assert "errors_when_winning" in keys
    assert "missed_punish" in keys
    winning = next(p for p in profile.patterns if p.key == "errors_when_winning")
    assert winning.examples and winning.examples[0].ply_index == 16

    # Every thrown game yields a puzzle whose solution is legal in its position.
    assert len(profile.puzzles) == 9
    for pz in profile.puzzles:
        board = chess.Board(pz.fen)
        assert chess.Move.from_uci(pz.best_move_uci) in board.legal_moves
        assert pz.best_move_san == board.san(chess.Move.from_uci(pz.best_move_uci))

    assert profile.training_plan and [t.priority for t in profile.training_plan] == list(
        range(1, len(profile.training_plan) + 1)
    )
    assert [m["month"] for m in profile.trends["monthly"]] == ["2026-05", "2026-06"]


def test_profile_without_analysis_has_no_skills():
    row = game_row("u", build_moves())
    row["summary_json"] = None
    row["moves_json"] = None
    profile = build_player_profile([row], ["Tim"])
    assert profile.total_games == 1
    assert profile.is_empty
    assert profile.skills == [] and profile.training_plan == []


def test_profile_ignores_games_of_other_players():
    profile = build_player_profile(_games(2, 2), ["someone-else"])
    assert profile.total_games == 0


def test_game_review_key_moments_and_lessons():
    review = build_game_review(game_analysis(build_moves(THROWN_WIN), result="0-1"), "white")

    assert review is not None
    assert review.result_text == "Niederlage gegen Gegner"
    plies = [k.ply_index for k in review.key_moments]
    assert plies == sorted(plies) and {15, 16} <= set(plies)
    user_err = next(k for k in review.key_moments if k.ply_index == 16)
    assert user_err.by_user and "Besser war" in user_err.text
    assert review.turning_point is not None and review.turning_point.ply_index == 16
    assert any("Wendepunkt" in lesson for lesson in review.lessons)
    assert review.move_counts["Blunder"] == 1


def test_game_review_requires_analysis():
    game = game_analysis(build_moves())
    for m in game.moves:
        m.classification = ""
    assert build_game_review(game, "white") is None


@pytest.mark.parametrize(
    ("accuracy", "expected"),
    [(97.0, "1,0 (sehr gut)"), (87.0, "2,0 (gut)"), (60.0, "5,5 (mangelhaft)"), (0.0, "–")],
)
def test_school_grade(accuracy, expected):
    assert school_grade(accuracy) == expected
