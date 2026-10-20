"""
Player profile & game review domain services (headless, zero Qt).

- build_player_profile: aggregates many games into skills, strengths/weaknesses,
  playing style, recurring patterns, a training plan and personal puzzles.
- build_game_review: German post-game review for a single analyzed game.
"""

from __future__ import annotations

from .builder import build_player_profile
from .features import GameFeatures, MoveEvent, extract_features
from .game_review import build_game_review, school_grade
from .models import (
    GameRef,
    GameReview,
    Insight,
    KeyMoment,
    OpeningLine,
    Pattern,
    PhaseReview,
    PlayerProfile,
    Puzzle,
    SkillScore,
    StyleAxis,
    StyleProfile,
    TrainingItem,
)

__all__ = [
    "GameFeatures",
    "GameRef",
    "GameReview",
    "Insight",
    "KeyMoment",
    "MoveEvent",
    "OpeningLine",
    "Pattern",
    "PhaseReview",
    "PlayerProfile",
    "Puzzle",
    "SkillScore",
    "StyleAxis",
    "StyleProfile",
    "TrainingItem",
    "build_game_review",
    "build_player_profile",
    "extract_features",
    "school_grade",
]
