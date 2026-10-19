"""
Typed result structures for the player profile and the per-game review.
All user-visible text in these structures is German.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class GameRef:
    """Pointer to a concrete position in a stored game (used for 'Beispiel ansehen')."""

    game_id: str
    ply_index: int = -1  # 0-based index into the move list; -1 = start of game
    label: str = ""
    detail: str = ""


@dataclass
class SkillScore:
    key: str
    name: str
    score: float  # 0..100
    grade: str
    detail: str
    sample: int
    reliable: bool = True


@dataclass
class Insight:
    key: str
    title: str
    text: str
    category: str  # e.g. "Fähigkeit", "Eröffnung", "Farbe", "Bedenkzeit"
    strength: float = 0.0  # how pronounced the finding is (for sorting)


@dataclass
class Pattern:
    key: str
    title: str
    text: str
    severity: str  # "hoch" | "mittel" | "niedrig" | "positiv"
    value: float = 0.0
    examples: list[GameRef] = field(default_factory=list)


@dataclass
class StyleAxis:
    key: str
    name: str
    value: float  # 0..100
    low_label: str
    high_label: str


@dataclass
class StyleProfile:
    label: str
    description: str
    axes: list[StyleAxis] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)


@dataclass
class TrainingItem:
    priority: int
    title: str
    reason: str
    steps: list[str] = field(default_factory=list)
    focus_skill: str = ""
    examples: list[GameRef] = field(default_factory=list)


@dataclass
class Puzzle:
    """A position from the player's own games where a better move existed."""

    game_id: str
    ply_index: int
    fen: str
    best_move_uci: str
    best_move_san: str
    played_san: str
    classification: str
    phase: str
    wp_loss: float
    opponent: str = ""
    date: str = ""
    chess960: bool = False


@dataclass
class OpeningLine:
    name: str
    eco: str
    color: str
    games: int
    score_pct: float  # (wins + 0.5 * draws) / games
    avg_accuracy: float
    first_error_move: float | None = None


@dataclass
class PlayerProfile:
    usernames: list[str]
    total_games: int
    analyzed_games: int
    overview: dict[str, Any] = field(default_factory=dict)
    skills: list[SkillScore] = field(default_factory=list)
    strengths: list[Insight] = field(default_factory=list)
    weaknesses: list[Insight] = field(default_factory=list)
    style: StyleProfile | None = None
    patterns: list[Pattern] = field(default_factory=list)
    openings_best: list[OpeningLine] = field(default_factory=list)
    openings_worst: list[OpeningLine] = field(default_factory=list)
    trends: dict[str, Any] = field(default_factory=dict)
    breakdowns: dict[str, Any] = field(default_factory=dict)
    training_plan: list[TrainingItem] = field(default_factory=list)
    puzzles: list[Puzzle] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return self.analyzed_games == 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class KeyMoment:
    ply_index: int
    move_label: str  # e.g. "23... Lxf7"
    by_user: bool
    classification: str
    title: str
    text: str
    wp_before: float  # user perspective, 0..1
    wp_after: float
    best_move_san: str = ""


@dataclass
class PhaseReview:
    phase: str
    name: str
    accuracy: float | None
    moves: int
    errors: int
    grade: str
    comment: str


@dataclass
class GameReview:
    game_id: str
    user_color: str
    headline: str
    result_text: str
    accuracy: float
    opponent_accuracy: float
    grade: str
    phases: list[PhaseReview] = field(default_factory=list)
    key_moments: list[KeyMoment] = field(default_factory=list)
    positives: list[str] = field(default_factory=list)
    negatives: list[str] = field(default_factory=list)
    lessons: list[str] = field(default_factory=list)
    move_counts: dict[str, int] = field(default_factory=dict)
    turning_point: KeyMoment | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
