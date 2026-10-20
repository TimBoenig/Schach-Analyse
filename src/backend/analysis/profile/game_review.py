"""
Per-game review: what went well, what went wrong, key moments and lessons,
written in German from the tracked player's perspective.
"""

from __future__ import annotations

from typing import Any

import chess

from src.backend.analysis.metrics.models import Outcome, outcome_for
from src.backend.analysis.tactics import analyze_game_tactics
from src.backend.analysis.tactics.phase import classify_game_phase
from src.backend.storage.models import GameAnalysis
from src.utils.translations import tr_classification, tr_phase, tr_phase_in, tr_piece

from .features import (
    ERROR_CLASSES,
    GOOD_CLASSES,
    SERIOUS_ERROR_CLASSES,
    move_label,
    san_for_uci,
    user_wp,
)
from .models import GameReview, KeyMoment, PhaseReview

MAX_KEY_MOMENTS = 6
# Swings smaller than 12 points of winning chance are rarely decisive enough to discuss.
KEY_MOMENT_MIN_SWING = 0.12


def school_grade(accuracy: float) -> str:
    """Map game accuracy to a German school grade (1,0 = sehr gut … 6,0 = ungenügend)."""
    if accuracy <= 0:
        return "–"
    value = 1.0 + (95.0 - accuracy) / 8.0
    value = max(1.0, min(6.0, round(value * 2) / 2))
    words = {
        1: "sehr gut",
        2: "gut",
        3: "befriedigend",
        4: "ausreichend",
        5: "mangelhaft",
        6: "ungenügend",
    }
    return f"{value:.1f}".replace(".", ",") + f" ({words[int(round(value - 0.01)) or 1]})"


def _pct(x: float) -> str:
    return f"{x * 100:.0f} %"


def _side_accuracy(game: GameAnalysis, color: str) -> float:
    summary = game.summary or {}
    side = summary.get(color)
    if isinstance(side, dict):
        try:
            return float(side.get("accuracy") or 0.0)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _phase_comment(name: str, acc: float | None, errors: int, moves: int) -> str:
    if acc is None or moves == 0:
        return f"Kein {name} in dieser Partie." if name != "Eröffnung" else "Nur Buchzüge."
    if acc >= 90 and errors == 0:
        return "Sehr sauber gespielt."
    if acc >= 80 and errors <= 1:
        return "Solide, kaum Ungenauigkeiten."
    if errors >= 2:
        return f"{errors} schwere Fehler – hier hast du die meisten Punkte abgegeben."
    return "Mehrere ungenaue Züge, hier steckt Verbesserungspotenzial."


def build_game_review(game: GameAnalysis, user_color: str) -> GameReview | None:
    """Create a review for an analyzed game; returns None if the game is not analyzed."""
    if not game.moves or not any(m.classification for m in game.moves):
        return None

    is_white = user_color == "white"
    opp_color = "black" if is_white else "white"
    chess960 = bool(game.metadata.chess960)
    moves_data = [m.to_dict() for m in game.moves]
    result = game.metadata.result or "*"
    speed = game.metadata.speed_category or "Blitz"
    tactics: dict[str, Any] = analyze_game_tactics(
        moves_data, user_color, result, speed_category=speed
    )

    acc = _side_accuracy(game, user_color)
    opp_acc = _side_accuracy(game, opp_color)
    outcome = outcome_for(result, user_color)
    opponent = game.metadata.black if is_white else game.metadata.white
    result_text = (
        {
            Outcome.WIN: f"Sieg gegen {opponent}",
            Outcome.DRAW: f"Remis gegen {opponent}",
            Outcome.LOSS: f"Niederlage gegen {opponent}",
        }.get(outcome, f"Partie gegen {opponent}")
        if outcome
        else f"Partie gegen {opponent}"
    )

    user_moves = []
    for idx, m in enumerate(game.moves):
        mover_white = " w " in f" {m.fen_before} " if m.fen_before else idx % 2 == 0
        if mover_white == is_white and m.classification:
            user_moves.append((idx, m))

    counts: dict[str, int] = {}
    for _, m in user_moves:
        counts[m.classification] = counts.get(m.classification, 0) + 1

    review = GameReview(
        game_id=game.game_id,
        user_color=user_color,
        headline="",
        result_text=result_text,
        accuracy=acc,
        opponent_accuracy=opp_acc,
        grade=school_grade(acc),
        move_counts=counts,
    )

    review.phases = _phases(tactics, user_moves, is_white)
    review.key_moments = _key_moments(game, is_white, chess960)
    review.turning_point = _turning_point(review.key_moments, outcome)
    review.positives, review.negatives, review.lessons = _assess(
        tactics, user_moves, review, outcome, acc, opp_acc, is_white
    )
    review.headline = _headline(outcome, acc, opp_acc, counts)
    return review


def _phases(tactics: dict[str, Any], user_moves: list, is_white: bool) -> list[PhaseReview]:
    per_phase: dict[str, list[str]] = {"opening": [], "middlegame": [], "endgame": []}
    for idx, m in user_moves:
        try:
            board = chess.Board(m.fen_before) if m.fen_before else chess.Board()
        except ValueError:
            continue
        per_phase[classify_game_phase(board, idx, is_book_move=m.is_book_move)].append(
            m.classification
        )

    out: list[PhaseReview] = []
    accs = tactics.get("phase_accuracies", {})
    for phase, classes in per_phase.items():
        acc = accs.get(phase)
        errors = sum(1 for c in classes if c in SERIOUS_ERROR_CLASSES)
        non_book = sum(1 for c in classes if c != "Book")
        name = tr_phase(phase)
        out.append(
            PhaseReview(
                phase=phase,
                name=name,
                accuracy=acc,
                moves=non_book,
                errors=errors,
                grade=school_grade(acc) if acc else "–",
                comment=_phase_comment(name, acc, errors, non_book),
            )
        )
    return out


def _key_moments(game: GameAnalysis, is_white: bool, chess960: bool) -> list[KeyMoment]:
    candidates: list[tuple[float, KeyMoment]] = []
    for idx, m in enumerate(game.moves):
        if not m.classification or m.classification == "Book":
            continue
        mover_white = " w " in f" {m.fen_before} " if m.fen_before else idx % 2 == 0
        by_user = mover_white == is_white
        wp_b = user_wp(m.win_chance_before, is_white)
        wp_a = user_wp(m.win_chance_after, is_white)
        swing = abs(wp_a - wp_b)
        brilliant = by_user and m.classification in ("Brilliant", "Great")
        if swing < KEY_MOMENT_MIN_SWING and not brilliant:
            continue
        label = move_label(m.move_number, mover_white, m.san)
        best_san = ""
        if m.best_move and m.best_move != m.uci:
            best_san = san_for_uci(m.fen_before, m.best_move, chess960)
        cls_de = tr_classification(m.classification)

        if by_user and m.classification in ERROR_CLASSES:
            title = f"{label} – {cls_de}"
            text = f"Deine Gewinnchance fiel von {_pct(wp_b)} auf {_pct(wp_a)}."
            if best_san:
                text += f" Besser war {best_san}."
        elif by_user and brilliant:
            title = f"{label} – {cls_de}!"
            text = m.explanation or "Ein starker Zug, den die Engine besonders hervorhebt."
            text += f" Gewinnchance jetzt {_pct(wp_a)}."
        elif by_user and wp_a >= wp_b:
            title = f"{label} – {cls_de}"
            text = f"Du hast die Chance genutzt: Gewinnchance von {_pct(wp_b)} auf {_pct(wp_a)}."
        elif by_user:
            # A large drop without an error label: the position was already slipping.
            continue
        else:
            if wp_a > wp_b:
                title = f"{label} – Fehler des Gegners"
                text = f"Dein Gegner hat gepatzt: deine Gewinnchance stieg auf {_pct(wp_a)}."
                if best_san:
                    text += f" (Er hätte {best_san} spielen sollen.)"
            else:
                title = f"{label} – starker Gegnerzug"
                text = (
                    f"Dein Gegner fand einen starken Zug, deine Gewinnchance sank auf {_pct(wp_a)}."
                )
        moment = KeyMoment(
            ply_index=idx,
            move_label=label,
            by_user=by_user,
            classification=m.classification,
            title=title,
            text=text,
            wp_before=round(wp_b, 3),
            wp_after=round(wp_a, 3),
            best_move_san=best_san,
        )
        candidates.append((swing + (0.3 if brilliant else 0.0), moment))

    top = sorted(candidates, key=lambda x: x[0], reverse=True)[:MAX_KEY_MOMENTS]
    return sorted((m for _, m in top), key=lambda m: m.ply_index)


def _turning_point(moments: list[KeyMoment], outcome: Outcome | None) -> KeyMoment | None:
    if not moments or outcome is None or outcome == Outcome.DRAW:
        return None
    if outcome == Outcome.LOSS:
        losing = [m for m in moments if m.wp_after < m.wp_before]
        return max(losing, key=lambda m: m.wp_before - m.wp_after) if losing else None
    winning = [m for m in moments if m.wp_after > m.wp_before]
    return max(winning, key=lambda m: m.wp_after - m.wp_before) if winning else None


def _assess(
    tactics: dict[str, Any],
    user_moves: list,
    review: GameReview,
    outcome: Outcome | None,
    acc: float,
    opp_acc: float,
    is_white: bool,
) -> tuple[list[str], list[str], list[str]]:
    pos: list[str] = []
    neg: list[str] = []
    lessons: list[str] = []
    counts = review.move_counts
    blunders = counts.get("Blunder", 0)
    mistakes = counts.get("Mistake", 0)
    misses = counts.get("Miss", 0)
    good = sum(counts.get(c, 0) for c in GOOD_CLASSES)
    total = sum(v for k, v in counts.items() if k != "Book")

    if acc >= 85:
        pos.append(f"Hohe Genauigkeit von {acc:.1f} % – du hast die meisten Züge sehr gut gewählt.")
    elif acc and opp_acc and acc > opp_acc + 5:
        pos.append(
            f"Du hast genauer gespielt als dein Gegner ({acc:.1f} % gegenüber {opp_acc:.1f} %)."
        )
    if total and good / total >= 0.6:
        pos.append(f"{good} von {total} Zügen waren beste oder exzellente Züge.")
    if counts.get("Brilliant", 0) or counts.get("Great", 0):
        pos.append(
            f"Starke Funde: {counts.get('Brilliant', 0)}× brillant, {counts.get('Great', 0)}× großartig."
        )
    if blunders == 0 and total >= 10:
        pos.append("Kein einziger Patzer in der ganzen Partie.")

    for p in review.phases:
        if p.accuracy and p.accuracy >= 88 and p.moves >= 5 and p.errors == 0:
            pos.append(f"{p.name} sehr sauber gespielt ({p.accuracy:.0f} %).")

    adv = tactics.get("advantage_metrics", {})
    if adv.get("converted_advantage"):
        pos.append("Deinen klaren Vorteil hast du sicher in einen Sieg umgewandelt.")
    if adv.get("comeback_wins"):
        pos.append("Starke Moral: Aus einer verlorenen Stellung hast du die Partie noch gewonnen.")
    elif adv.get("comeback_draws"):
        pos.append("Aus einer verlorenen Stellung hast du noch ein Remis gerettet.")

    hang = tactics.get("hanging_metrics", {})
    if hang.get("opponent_hanging_captured", 0):
        pos.append(
            f"{hang['opponent_hanging_captured']}× hängendes Material des Gegners eingesammelt."
        )

    # --- Negatives & lessons ---
    if blunders:
        neg.append(
            "1 Patzer hat die Stellung deutlich verschlechtert."
            if blunders == 1
            else f"{blunders} Patzer – jeder davon hat die Stellung deutlich verschlechtert."
        )
    if mistakes:
        neg.append(
            "1 Fehler hat dich Vorteil gekostet."
            if mistakes == 1
            else f"{mistakes} Fehler haben dich Vorteil gekostet."
        )
    if misses:
        neg.append(f"{misses}× eine klare Chance verpasst, den Gegner zu bestrafen.")
        lessons.append(
            "Nach jedem gegnerischen Zug prüfen: Hängt jetzt etwas? Gibt es Schachs oder Schläge?"
        )

    hung = hang.get("total_hung", 0)
    if hung:
        by_piece = {k: v for k, v in hang.get("by_piece", {}).items() if v}
        pieces = ", ".join(f"{v}× {tr_piece(k)}" for k, v in by_piece.items())
        neg.append(f"Figuren ungedeckt gelassen bzw. eingestellt: {pieces or hung}.")
        lessons.append(
            "Vor jedem Zug den Blunder-Check: Welche meiner Figuren sind danach ungedeckt?"
        )

    if adv.get("thrown_losses"):
        neg.append("Eine klar gewonnene Stellung (+3) ging noch verloren.")
        lessons.append(
            "Mit großem Vorteil: Figuren tauschen, Gegenspiel verhindern und keine Hektik."
        )
    elif adv.get("squandered_draws"):
        neg.append("Eine gewonnene Stellung endete nur remis.")
        lessons.append(
            "Mit Vorteil die Technik üben: Spiele solche Stellungen gegen die Engine zu Ende."
        )

    worst_phase = max(review.phases, key=lambda p: p.errors) if review.phases else None
    if worst_phase and worst_phase.errors >= 2:
        neg.append(f"Die meisten schweren Fehler passierten {tr_phase_in(worst_phase.phase)}.")
        lessons.append(
            {
                "opening": "Lerne die Pläne deiner Eröffnung, nicht nur die ersten Züge.",
                "middlegame": "Im Mittelspiel vor jedem Zug Drohungen und Kandidatenzüge sammeln.",
                "endgame": "Grundendspiele wiederholen und den König im Endspiel aktivieren.",
            }[worst_phase.phase]
        )

    cm = tactics.get("clock_metrics", {})
    if cm.get("trouble_blunders", 0):
        neg.append(f"{cm['trouble_blunders']} Patzer in Zeitnot.")
        lessons.append(
            "Teile deine Zeit besser ein, damit kritische Momente nicht in Zeitnot fallen."
        )
    quality_pace = cm.get("quality_timed_moves", {})
    if (
        quality_pace.get("blunder", 0)
        and cm.get("quality_time_spent", {}).get("blunder", 0.0)
        / max(1, quality_pace.get("blunder", 0))
        < 4.0
    ):
        lessons.append(
            "Deine Patzer kamen schnell – in angespannten Stellungen bewusst langsamer ziehen."
        )

    if review.turning_point and outcome == Outcome.LOSS:
        tp = review.turning_point
        lessons.insert(
            0,
            f"Wendepunkt war {tp.move_label}: Hier lohnt es sich, die Stellung nachzuspielen"
            + (
                f" und {tp.best_move_san} zu verstehen." if tp.best_move_san and tp.by_user else "."
            ),
        )

    if not neg:
        neg.append("Keine größeren Schwächen – eine sehr saubere Partie.")
    if not lessons:
        lessons.append("Weiter so! Schau dir die Schlüsselmomente an, um noch präziser zu werden.")
    if not pos:
        pos.append("Du hast die Partie zu Ende gekämpft – analysiere die Schlüsselmomente unten.")
    # De-duplicate while preserving order.
    return list(dict.fromkeys(pos)), list(dict.fromkeys(neg)), list(dict.fromkeys(lessons))[:5]


def _headline(outcome: Outcome | None, acc: float, opp_acc: float, counts: dict[str, int]) -> str:
    blunders = counts.get("Blunder", 0)
    if outcome == Outcome.WIN:
        if acc >= 90:
            return "Eine Glanzleistung – präzise von Anfang bis Ende."
        if blunders:
            return "Gewonnen, aber nicht fehlerfrei – hier steckt noch Potenzial."
        return "Verdienter Sieg mit solidem Spiel."
    if outcome == Outcome.LOSS:
        if acc >= 80:
            return "Knappe Niederlage trotz guter Leistung."
        if blunders:
            return (
                "Ein Patzer hat die Partie entschieden."
                if blunders == 1
                else f"{blunders} Patzer haben die Partie entschieden."
            )
        return "Der Gegner war heute genauer."
    if outcome == Outcome.DRAW:
        return "Remis – schau dir an, wo mehr drin war."
    return "Partie-Review"
