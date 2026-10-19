"""
Player profile assembly: combines aggregated statistics, per-game features,
skill scores, style, patterns and a training plan into one PlayerProfile.
"""

from __future__ import annotations

import datetime
from collections import defaultdict
from typing import Any

from src.backend.analysis.metrics.accumulators import StatsAccumulator
from src.backend.analysis.metrics.filters import filter_games
from src.backend.analysis.metrics.models import GameRecord
from src.utils.logger import logger
from src.utils.translations import tr_color, tr_speed

from .features import GameFeatures, extract_features, san_for_uci
from .models import Insight, OpeningLine, PlayerProfile, Puzzle, SkillScore
from .patterns import detect_patterns
from .skills import compute_skills
from .style import build_style
from .training import build_training_plan

MIN_OPENING_GAMES = 3
MAX_PUZZLES = 60
# Only clear errors become puzzles: a drop of 20 points in winning chances.
PUZZLE_MIN_WP_LOSS = 0.20

_STRENGTH_TEXT: dict[str, str] = {
    "opening": "Du kommst gut aus der Eröffnung und legst damit die Basis für deine Partien.",
    "middlegame": "Im Mittelspiel triffst du überwiegend gute Entscheidungen.",
    "endgame": "Im Endspiel spielst du präzise – ein echter Vorteil in langen Partien.",
    "tactics": "Du erkennst taktische Chancen und bestrafst Fehler deiner Gegner konsequent.",
    "safety": "Du stellst selten Figuren ein und machst wenige grobe Patzer.",
    "conversion": "Gewonnene Stellungen bringst du zuverlässig nach Hause.",
    "defense": "Du kämpfst in schlechteren Stellungen und rettest oft noch Punkte.",
    "time": "Du teilst deine Bedenkzeit gut ein.",
    "consistency": "Deine Leistung ist von Partie zu Partie sehr stabil.",
}

_WEAKNESS_TEXT: dict[str, str] = {
    "opening": "Schon in der Eröffnung verlierst du häufig an Boden.",
    "middlegame": "Im Mittelspiel unterlaufen dir die meisten Ungenauigkeiten.",
    "endgame": "Im Endspiel gibst du oft Vorteile ab oder verlierst ausgeglichene Stellungen.",
    "tactics": "Du übersiehst häufig taktische Chancen – Gegnerfehler bleiben oft unbestraft.",
    "safety": "Eingestellte Figuren und grobe Patzer kosten dich viele Punkte.",
    "conversion": "Gewonnene Stellungen gibst du zu oft noch aus der Hand.",
    "defense": "In schlechteren Stellungen bricht deine Verteidigung schnell zusammen.",
    "time": "Die Zeiteinteilung kostet dich Punkte (Zeitnot oder Zeitverluste).",
    "consistency": "Deine Leistung schwankt stark zwischen guten und schwachen Partien.",
}


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _score_of(feats: list[GameFeatures]) -> float:
    scores = [f.score for f in feats if f.score is not None]
    return _avg([s for s in scores if s is not None]) * 100.0


def build_player_profile(
    games: list[dict[str, Any]],
    usernames: list[str] | set[str],
    format_filter: str = "All Formats",
    date_filter: str = "All Time",
    color_filter: str = "All Colors",
) -> PlayerProfile:
    """Build the complete player profile for the tracked usernames."""
    names = sorted({u for u in usernames if u})
    matched = filter_games(
        games,
        names,
        color_filter=color_filter,
        format_filter=format_filter,
        date_filter=date_filter,
    )
    acc = StatsAccumulator()
    feats: list[GameFeatures] = []
    for game, color in matched:
        try:
            rec = GameRecord.from_dict(game, color)
            acc.add(rec)
            feats.append(extract_features(game, color, rec=rec))
        except Exception as exc:  # one corrupt game must not break the whole profile
            logger.warning("Profile: skipping game %s: %s", game.get("id"), exc)

    stats = acc.finalize(
        color_filter=color_filter, format_filter=format_filter, date_filter=date_filter
    )
    analyzed = [f for f in feats if f.analyzed]
    profile = PlayerProfile(usernames=names, total_games=len(feats), analyzed_games=len(analyzed))
    profile.overview = _overview(stats, feats, analyzed)
    profile.trends = _trends(feats)
    profile.breakdowns = _breakdowns(feats)
    if not analyzed:
        return profile

    profile.skills = compute_skills(stats, feats)
    profile.strengths, profile.weaknesses = _strengths_weaknesses(profile.skills)
    best, worst = _openings(feats)
    profile.openings_best, profile.openings_worst = best, worst
    _context_insights(profile, feats)
    profile.style = build_style(analyzed, profile.skills)
    profile.patterns = detect_patterns(feats)
    worst_name = worst[0].name if worst else ""
    profile.training_plan = build_training_plan(profile.skills, profile.patterns, stats, worst_name)
    profile.puzzles = _puzzles(analyzed)
    return profile


def _overview(
    stats: dict[str, Any], feats: list[GameFeatures], analyzed: list[GameFeatures]
) -> dict[str, Any]:
    ratings: dict[str, tuple[float, int]] = {}
    for f in feats:
        if f.user_rating and f.played_at:
            prev = ratings.get(f.rec.speed)
            if prev is None or f.played_at > prev[0]:
                ratings[f.rec.speed] = (f.played_at, f.user_rating)
    recent = sorted(analyzed, key=lambda f: f.played_at or 0)
    last = recent[-20:]
    before = recent[-40:-20]
    form_delta = (
        _avg([f.rec.game_acc for f in last]) - _avg([f.rec.game_acc for f in before])
        if len(before) >= 5
        else None
    )
    return {
        "games": stats.get("total", 0),
        "wins": stats.get("wins", 0),
        "draws": stats.get("draws", 0),
        "losses": stats.get("losses", 0),
        "win_rate": stats.get("win_rate", 0.0),
        "score_pct": _score_of(feats),
        "avg_accuracy": stats.get("avg_accuracy", 0.0),
        "analyzed": len(analyzed),
        "clean_games_pct": stats.get("clean_games_pct", 0.0),
        "ratings": {tr_speed(k): v[1] for k, v in sorted(ratings.items())},
        "best_win": stats.get("best_win", ""),
        "brilliant_moves": stats.get("detailed_quality_counts", {}).get("Brilliant", 0),
        "great_moves": stats.get("detailed_quality_counts", {}).get("Great", 0),
        "form_delta": form_delta,
        "quality_counts": stats.get("detailed_quality_counts", {}),
    }


def _strengths_weaknesses(skills: list[SkillScore]) -> tuple[list[Insight], list[Insight]]:
    reliable = [s for s in skills if s.reliable]
    if not reliable:
        return [], []
    mean = _avg([s.score for s in reliable])
    ranked = sorted(reliable, key=lambda s: s.score, reverse=True)
    strengths = [s for s in ranked if s.score >= 65 or s.score >= mean + 8][:3]
    weaknesses = [s for s in reversed(ranked) if s.score < 45 or s.score <= mean - 8][:3]
    # Always name at least one of each, relative to the player's own level.
    if not strengths and len(ranked) >= 3:
        strengths = ranked[:1]
    if not weaknesses and len(ranked) >= 3:
        weaknesses = ranked[-1:]
    weaknesses = [w for w in weaknesses if w not in strengths]
    return (
        [
            Insight(
                key=s.key,
                title=s.name,
                text=f"{_STRENGTH_TEXT.get(s.key, '')} ({s.detail})",
                category="Fähigkeit",
                strength=s.score - mean,
            )
            for s in strengths
        ],
        [
            Insight(
                key=s.key,
                title=s.name,
                text=f"{_WEAKNESS_TEXT.get(s.key, '')} ({s.detail})",
                category="Fähigkeit",
                strength=mean - s.score,
            )
            for s in weaknesses
        ],
    )


def _opening_lines(feats: list[GameFeatures]) -> list[OpeningLine]:
    groups: dict[tuple[str, str], list[GameFeatures]] = defaultdict(list)
    for f in feats:
        if f.rec.opening and f.score is not None:
            main = f.rec.opening.split(":")[0].split(",")[0].strip()
            groups[(main, f.rec.user_color)].append(f)
    lines: list[OpeningLine] = []
    for (name, color), fs in groups.items():
        if len(fs) < MIN_OPENING_GAMES:
            continue
        first_err = [
            float(next(m.move_number for m in f.moves if m.is_serious_error))
            for f in fs
            if any(m.is_serious_error for m in f.moves)
        ]
        lines.append(
            OpeningLine(
                name=name,
                eco=next((f.rec.eco for f in fs if f.rec.eco), ""),
                color=color,
                games=len(fs),
                score_pct=_score_of(fs),
                avg_accuracy=_avg([f.rec.game_acc for f in fs if f.rec.game_acc > 0]),
                first_error_move=_avg(first_err) if first_err else None,
            )
        )
    return lines


def _openings(feats: list[GameFeatures]) -> tuple[list[OpeningLine], list[OpeningLine]]:
    lines = _opening_lines(feats)
    by_score = sorted(lines, key=lambda o: (o.score_pct, o.games), reverse=True)
    best = [o for o in by_score if o.score_pct >= 50][:5]
    worst = [o for o in reversed(by_score) if o.score_pct < 50][:5]
    return best, worst


def _context_insights(profile: PlayerProfile, feats: list[GameFeatures]) -> None:
    """Add color, format and opening findings to strengths/weaknesses."""
    by_color = {c: [f for f in feats if f.rec.user_color == c] for c in ("white", "black")}
    if all(len(v) >= 8 for v in by_color.values()):
        sw, sb = _score_of(by_color["white"]), _score_of(by_color["black"])
        if abs(sw - sb) >= 10:
            better, worse = ("white", "black") if sw > sb else ("black", "white")
            profile.weaknesses.append(
                Insight(
                    key=f"color_{worse}",
                    title=f"Ergebnisse mit {tr_color(worse)}",
                    text=(
                        f"Mit {tr_color(worse)} holst du {min(sw, sb):.0f} % der Punkte, mit "
                        f"{tr_color(better)} {max(sw, sb):.0f} %. Dein Repertoire mit "
                        f"{tr_color(worse)} verdient Aufmerksamkeit."
                    ),
                    category="Farbe",
                    strength=abs(sw - sb) / 2,
                )
            )

    if profile.openings_best:
        o = profile.openings_best[0]
        if o.score_pct >= 60:
            profile.strengths.append(
                Insight(
                    key="opening_best",
                    title=f"Erfolgseröffnung: {o.name}",
                    text=(
                        f"Mit {tr_color(o.color)} holst du hier {o.score_pct:.0f} % der Punkte "
                        f"({o.games} Partien, Ø {o.avg_accuracy:.1f} % Genauigkeit)."
                    ),
                    category="Eröffnung",
                    strength=(o.score_pct - 50) / 2,
                )
            )
    if profile.openings_worst:
        o = profile.openings_worst[0]
        if o.score_pct <= 40:
            profile.weaknesses.append(
                Insight(
                    key="opening_worst",
                    title=f"Problemeröffnung: {o.name}",
                    text=(
                        f"Mit {tr_color(o.color)} holst du hier nur {o.score_pct:.0f} % der Punkte "
                        f"({o.games} Partien)."
                        + (
                            f" Der erste schwere Fehler kommt im Schnitt in Zug {o.first_error_move:.0f}."
                            if o.first_error_move
                            else ""
                        )
                    ),
                    category="Eröffnung",
                    strength=(50 - o.score_pct) / 2,
                )
            )

    speeds: dict[str, list[GameFeatures]] = defaultdict(list)
    for f in feats:
        speeds[f.rec.speed].append(f)
    rated = {k: v for k, v in speeds.items() if len(v) >= 8}
    if len(rated) >= 2:
        acc_by = {k: _avg([f.rec.game_acc for f in v if f.analyzed]) for k, v in rated.items()}
        acc_by = {k: v for k, v in acc_by.items() if v > 0}
        if len(acc_by) >= 2:
            best_k = max(acc_by, key=lambda k: acc_by[k])
            worst_k = min(acc_by, key=lambda k: acc_by[k])
            if acc_by[best_k] - acc_by[worst_k] >= 4:
                profile.strengths.append(
                    Insight(
                        key="speed_best",
                        title=f"Stärkste Bedenkzeit: {tr_speed(best_k)}",
                        text=(
                            f"In {tr_speed(best_k)} spielst du mit Ø {acc_by[best_k]:.1f} % am "
                            f"genauesten, in {tr_speed(worst_k)} nur mit {acc_by[worst_k]:.1f} %."
                        ),
                        category="Bedenkzeit",
                        strength=(acc_by[best_k] - acc_by[worst_k]) / 2,
                    )
                )


def _month_key(ts: float) -> str:
    return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime("%Y-%m")


def _trends(feats: list[GameFeatures]) -> dict[str, Any]:
    months: dict[str, list[GameFeatures]] = defaultdict(list)
    rating_points: dict[str, list[tuple[float, int]]] = defaultdict(list)
    for f in feats:
        if not f.played_at:
            continue
        months[_month_key(f.played_at)].append(f)
        if f.user_rating:
            rating_points[tr_speed(f.rec.speed)].append((f.played_at, f.user_rating))
    monthly = []
    for key in sorted(months):
        fs = months[key]
        accs = [f.rec.game_acc for f in fs if f.analyzed]
        monthly.append(
            {
                "month": key,
                "games": len(fs),
                "score_pct": _score_of(fs),
                "avg_accuracy": _avg(accs) if accs else None,
                "blunders_per_game": (
                    _avg([float(f.rec.quality_counts.get("Blunder", 0)) for f in fs if f.analyzed])
                    if accs
                    else None
                ),
            }
        )
    return {
        "monthly": monthly,
        "ratings": {k: sorted(v) for k, v in rating_points.items() if len(v) >= 2},
    }


def _breakdowns(feats: list[GameFeatures]) -> dict[str, Any]:
    def row(label: str, fs: list[GameFeatures]) -> dict[str, Any]:
        finished = [f for f in fs if f.score is not None]
        return {
            "label": label,
            "games": len(fs),
            "wins": sum(1 for f in finished if f.rec.is_win),
            "draws": sum(1 for f in finished if f.rec.is_draw),
            "losses": sum(1 for f in finished if f.rec.is_loss),
            "score_pct": _score_of(fs),
            "avg_accuracy": _avg([f.rec.game_acc for f in fs if f.analyzed]),
        }

    by_color = [
        row(tr_color(c), [f for f in feats if f.rec.user_color == c]) for c in ("white", "black")
    ]
    speeds: dict[str, list[GameFeatures]] = defaultdict(list)
    for f in feats:
        speeds[f.rec.speed].append(f)
    by_speed = [row(tr_speed(k), v) for k, v in sorted(speeds.items(), key=lambda x: -len(x[1]))]

    buckets: dict[str, list[GameFeatures]] = {
        "Stärkere Gegner (+100)": [],
        "Ähnlich stark (±100)": [],
        "Schwächere Gegner (−100)": [],
    }
    for f in feats:
        if not f.user_rating or not f.opp_rating:
            continue
        diff = f.opp_rating - f.user_rating
        key = (
            "Stärkere Gegner (+100)"
            if diff >= 100
            else "Schwächere Gegner (−100)"
            if diff <= -100
            else "Ähnlich stark (±100)"
        )
        buckets[key].append(f)
    by_opponent = [row(k, v) for k, v in buckets.items() if v]
    return {"color": by_color, "speed": by_speed, "opponent": by_opponent}


def _puzzles(analyzed: list[GameFeatures]) -> list[Puzzle]:
    candidates = [
        (f, m)
        for f in analyzed
        for m in f.moves
        if m.is_serious_error
        and m.wp_drop >= PUZZLE_MIN_WP_LOSS
        and m.best_move_uci
        and m.best_move_uci != m.uci
    ]
    candidates.sort(key=lambda x: (x[0].played_at or 0, x[1].wp_drop), reverse=True)
    puzzles: list[Puzzle] = []
    for f, m in candidates[:MAX_PUZZLES]:
        puzzles.append(
            Puzzle(
                game_id=f.game_id,
                ply_index=m.ply_index,
                fen=m.fen_before,
                best_move_uci=m.best_move_uci or "",
                best_move_san=san_for_uci(m.fen_before, m.best_move_uci, f.chess960),
                played_san=m.san,
                classification=m.classification,
                phase=m.phase,
                wp_loss=round(m.wp_drop, 3),
                opponent=f.rec.opp_name,
                date=f.date,
                chess960=f.chess960,
            )
        )
    return puzzles
