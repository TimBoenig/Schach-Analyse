"""
Skill scoring (0-100) for the player profile.

Each skill maps a raw metric onto a 0-100 scale between a "weak" and a
"strong" anchor. The anchors are deliberately simple, club-player oriented
reference points so the scores stay explainable in the UI ("why is my
endgame 48?") instead of being an opaque model.
"""

from __future__ import annotations

import statistics
from typing import Any

from src.backend.analysis.metrics.accumulators import pct

from .features import GameFeatures
from .models import SkillScore

# Minimum evidence before a skill is used for strengths/weaknesses.
MIN_GAMES = 5
MIN_PHASE_MOVES = 40
MIN_SITUATIONS = 3


def scale(value: float, weak: float, strong: float) -> float:
    """Linear map of value onto 0..100 where `weak`->0 and `strong`->100 (either direction)."""
    if strong == weak:
        return 50.0
    t = (value - weak) / (strong - weak)
    return round(max(0.0, min(1.0, t)) * 100.0, 1)


def grade_for(score: float) -> str:
    if score >= 80:
        return "Sehr stark"
    if score >= 65:
        return "Stark"
    if score >= 50:
        return "Solide"
    if score >= 35:
        return "Ausbaufähig"
    return "Schwach"


SKILL_NAMES: dict[str, str] = {
    "opening": "Eröffnung",
    "middlegame": "Mittelspiel",
    "endgame": "Endspiel",
    "tactics": "Taktisches Sehen",
    "safety": "Figurensicherheit",
    "conversion": "Vorteilsverwertung",
    "defense": "Verteidigung",
    "time": "Zeitmanagement",
    "consistency": "Konstanz",
}


def _phase_skill(key: str, stats: dict[str, Any], feats: list[GameFeatures]) -> SkillScore:
    acc = stats.get("phase_stats", {}).get("accuracies", {}).get(key, 0.0)
    moves = sum(1 for f in feats for m in f.moves if m.phase == key and not m.is_book)
    serious = sum(1 for f in feats for m in f.moves if m.phase == key and m.is_serious_error)
    per100 = serious / moves * 100 if moves else 0.0
    score = round(0.75 * scale(acc, 55, 95) + 0.25 * scale(per100, 8, 0), 1)
    detail = (
        f"{acc:.1f} % Genauigkeit, {per100:.1f} Fehler/Patzer pro 100 Züge"
        if moves
        else "Noch keine analysierten Züge in dieser Phase"
    )
    return SkillScore(
        key=key,
        name=SKILL_NAMES[key],
        score=score,
        grade=grade_for(score),
        detail=detail,
        sample=moves,
        reliable=moves >= MIN_PHASE_MOVES,
    )


def compute_skills(stats: dict[str, Any], feats: list[GameFeatures]) -> list[SkillScore]:
    """Compute all skill scores from aggregated stats plus move-level features."""
    analyzed = [f for f in feats if f.analyzed]
    n = len(analyzed)
    skills = [_phase_skill(p, stats, analyzed) for p in ("opening", "middlegame", "endgame")]

    # Tactical vision: punishing opponent errors and taking hanging material.
    chances = sum(f.punish_chances for f in analyzed)
    punished = sum(f.punished for f in analyzed)
    hanging = stats.get("hanging_stats", {})
    opp_cap = hanging.get("opponent_hanging_captured", 0)
    opp_miss = hanging.get("opponent_hanging_missed", 0)
    punish_rate = punished / chances if chances else 0.0
    take_rate = opp_cap / (opp_cap + opp_miss) if (opp_cap + opp_miss) else punish_rate
    misses = sum(1 for f in analyzed for m in f.moves if m.classification == "Miss")
    tactic_score = round(
        0.5 * scale(punish_rate, 0.35, 0.9)
        + 0.3 * scale(take_rate, 0.5, 0.95)
        + 0.2 * scale(misses / n if n else 0.0, 1.5, 0.1),
        1,
    )
    skills.append(
        SkillScore(
            key="tactics",
            name=SKILL_NAMES["tactics"],
            score=tactic_score,
            grade=grade_for(tactic_score),
            detail=(
                f"{pct(punished, chances):.0f} % der gegnerischen Fehler bestraft "
                f"({punished}/{chances}), {misses} verpasste Chancen"
            ),
            sample=chances,
            reliable=chances >= MIN_SITUATIONS * 2,
        )
    )

    # Piece safety: blunders per 100 moves and hung pieces per game.
    user_moves = sum(f.user_move_count for f in analyzed)
    blunders = sum(1 for f in analyzed for m in f.moves if m.classification == "Blunder")
    blunder_rate = blunders / user_moves * 100 if user_moves else 0.0
    hung_per_game = hanging.get("total_hung", 0) / n if n else 0.0
    safety = round(0.6 * scale(blunder_rate, 5.0, 0.3) + 0.4 * scale(hung_per_game, 1.5, 0.1), 1)
    skills.append(
        SkillScore(
            key="safety",
            name=SKILL_NAMES["safety"],
            score=safety,
            grade=grade_for(safety),
            detail=(
                f"{blunder_rate:.1f} Patzer pro 100 Züge, "
                f"{hung_per_game:.2f} eingestellte Figuren pro Partie"
            ),
            sample=user_moves,
            reliable=n >= MIN_GAMES,
        )
    )

    adv = stats.get("advantage_stats", {})
    had_win = adv.get("had_winning_advantage", 0)
    conv = adv.get("conversion_rate", 0.0)
    conv_score = scale(conv, 20, 90)
    skills.append(
        SkillScore(
            key="conversion",
            name=SKILL_NAMES["conversion"],
            score=conv_score,
            grade=grade_for(conv_score),
            detail=(
                f"{conv:.0f} % der klar gewonnenen Stellungen (+3) auch gewonnen "
                f"({adv.get('converted_advantage', 0)}/{had_win})"
            ),
            sample=had_win,
            reliable=had_win >= MIN_SITUATIONS,
        )
    )

    had_lose = adv.get("had_losing_position", 0)
    comeback = adv.get("comeback_rate", 0.0)
    def_score = scale(comeback, 5, 50)
    skills.append(
        SkillScore(
            key="defense",
            name=SKILL_NAMES["defense"],
            score=def_score,
            grade=grade_for(def_score),
            detail=(
                f"{comeback:.0f} % der klar verlorenen Stellungen (-3) noch gehalten oder gedreht "
                f"({adv.get('comeback_drawn_or_won', 0)}/{had_lose})"
            ),
            sample=had_lose,
            reliable=had_lose >= MIN_SITUATIONS,
        )
    )

    skills.append(_time_skill(stats, analyzed))

    accs = [f.rec.game_acc for f in analyzed if f.rec.game_acc > 0]
    spread = statistics.pstdev(accs) if len(accs) >= 2 else 0.0
    cons = scale(spread, 18, 5)
    skills.append(
        SkillScore(
            key="consistency",
            name=SKILL_NAMES["consistency"],
            score=cons,
            grade=grade_for(cons),
            detail=f"Genauigkeit schwankt um ±{spread:.1f} Prozentpunkte von Partie zu Partie",
            sample=len(accs),
            reliable=len(accs) >= MIN_GAMES,
        )
    )
    return skills


def _time_skill(stats: dict[str, Any], analyzed: list[GameFeatures]) -> SkillScore:
    time_s = stats.get("time_stats", {})
    if not time_s.get("has_clock_data"):
        return SkillScore(
            key="time",
            name=SKILL_NAMES["time"],
            score=50.0,
            grade="Keine Uhrdaten",
            detail="Die Partien enthalten keine Uhrzeiten (z. B. reine PGN ohne %clk).",
            sample=0,
            reliable=False,
        )
    tt = time_s.get("time_trouble", {})
    losses = stats.get("losses", 0)
    time_losses = tt.get("total_time_losses", 0)
    time_loss_share = time_losses / losses if losses else 0.0
    panic = tt.get("panic_multiplier", 1.0)
    # 0 means "no blunders at all" (no ratio to compute) - treat as neutral 1x.
    panic = 4.0 if panic == float("inf") else (panic or 1.0)
    trouble_games = sum(1 for f in analyzed if any(m.in_time_trouble for m in f.moves))
    trouble_share = trouble_games / len(analyzed) if analyzed else 0.0
    score = round(
        0.4 * scale(time_loss_share, 0.4, 0.0)
        + 0.3 * scale(panic, 3.0, 1.0)
        + 0.3 * scale(trouble_share, 0.6, 0.1),
        1,
    )
    return SkillScore(
        key="time",
        name=SKILL_NAMES["time"],
        score=score,
        grade=grade_for(score),
        detail=(
            f"{time_losses} Niederlagen durch Zeit, in {trouble_share * 100:.0f} % der Partien "
            f"in Zeitnot, Patzerrisiko in Zeitnot {panic:.1f}×"
        ),
        sample=tt.get("trouble_moves", 0) + tt.get("normal_moves", 0),
        reliable=len(analyzed) >= MIN_GAMES,
    )
