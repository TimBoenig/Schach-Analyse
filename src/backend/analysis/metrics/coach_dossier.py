"""
Coach dossier generation module for AI Chess Coach prompt formatting.
Translates statistical aggregations into a high-signal text dossier.
"""

from __future__ import annotations

import math
from typing import Any

from src.utils.translations import tr_motif, tr_speed


def _header_section(stats: dict[str, Any]) -> list[str]:
    total = stats.get("total", 0)
    win_rate = stats.get("win_rate", 0.0)
    wins = stats.get("wins", 0)
    draws = stats.get("draws", 0)
    losses = stats.get("losses", 0)
    avg_accuracy = stats.get("avg_accuracy", 0.0)
    clean_games_pct = stats.get("clean_games_pct", 0.0)
    clean_games = stats.get("clean_games", 0)

    return [
        f"=== LEISTUNGSDOSSIER DES SCHÜLERS (Stichprobe: {total} Partien) ===",
        f"Gesamt-Siegquote: {win_rate:.1f}% ({wins}S / {draws}R / {losses}N)",
        (
            f"Durchschnittliche Genauigkeit: {avg_accuracy:.1f}% | "
            f"Fehlerfreie Partien: {clean_games_pct:.1f}% ({clean_games} Partien ohne Patzer)"
        ),
    ]


def _phase_section(stats: dict[str, Any]) -> list[str]:
    phases = stats.get("phase_stats", {})
    accs = phases.get("accuracies", {})
    blunds = phases.get("blunders", {})
    return [
        "\nGenauigkeit nach Phase & Patzerverteilung:",
        f"- Eröffnung: {accs.get('opening', 0.0):.1f}% Genauigkeit | {blunds.get('opening', 0)} Patzer",
        (
            f"- Mittelspiel: {accs.get('middlegame', 0.0):.1f}% Genauigkeit | "
            f"{blunds.get('middlegame', 0)} Patzer"
        ),
        f"- Endspiel: {accs.get('endgame', 0.0):.1f}% Genauigkeit | {blunds.get('endgame', 0)} Patzer",
    ]


def _advantage_section(stats: dict[str, Any]) -> list[str]:
    adv = stats.get("advantage_stats", {})
    hwa = adv.get("had_winning_advantage", 0)
    hlp = adv.get("had_losing_position", 0)
    lines = ["\nVorteilsverwertung & Kampfgeist:"]

    if hwa > 0:
        lines.append(
            f"- Verwertung entscheidender Vorteile (+3,0+ Bauern): {adv.get('conversion_rate', 0.0):.1f}% "
            f"({adv.get('converted_advantage', 0)} Siege aus {hwa} Partien mit Vorteil)"
        )
        lines.append(
            f"- Verspielte Vorteile: {adv.get('thrown_losses', 0)} Niederlagen, "
            f"{adv.get('squandered_draws', 0)} Remis aus Gewinnstellungen"
        )
    else:
        lines.append("- Entscheidende Vorteile (+3,0+): In dieser Stichprobe keine erreicht.")

    if hlp > 0:
        lines.append(
            f"- Aufholquote bei Rückstand (-3,0- Bauern): {adv.get('comeback_rate', 0.0):.1f}% "
            f"({adv.get('comeback_wins', 0)} Siege, {adv.get('comeback_draws', 0)} Remis aus {hlp} Partien mit Rückstand)"
        )
    else:
        lines.append("- Entscheidende Rückstände (-3,0-): In dieser Stichprobe keine zugelassen.")

    return lines


def _tactics_section(stats: dict[str, Any]) -> list[str]:
    hanging = stats.get("hanging_stats", {})
    by_p = hanging.get("by_piece", {})
    tactics = stats.get("tactical_themes", {})
    top_motifs = sorted(tactics.items(), key=lambda x: x[1], reverse=True)
    motifs_str = ", ".join(f"{tr_motif(k)}: {v}" for k, v in top_motifs if v > 0)
    brills = len(stats.get("brilliancies", []))

    return [
        "\nTaktikprofil & Brettübersicht:",
        (
            f"- Eingestellte ungedeckte Figuren: {hanging.get('total_hung', 0)} "
            f"(B: {by_p.get('pawn', 0)}, "
            f"S: {by_p.get('knight', 0)}, "
            f"L: {by_p.get('bishop', 0)}, "
            f"T: {by_p.get('rook', 0)}, "
            f"D: {by_p.get('queen', 0)})"
        ),
        (
            f"- Hängende gegnerische Figuren bestraft: {hanging.get('opponent_hanging_captured', 0)} geschlagen "
            f"vs. {hanging.get('opponent_hanging_missed', 0)} verpasste Gelegenheiten"
        ),
        f"- Ausgeführte Taktikmotive: {motifs_str if motifs_str else 'Keine erkannt'}",
        f"- Brillante Züge (!!): {brills}",
    ]


def _clock_section(stats: dict[str, Any]) -> list[str]:
    time_s = stats.get("time_stats", {})
    if not time_s.get("has_clock_data"):
        return []

    tt = time_s.get("time_trouble", {})
    formats = time_s.get("formats", {})
    lines = [
        "\nZeitmanagement & Uhrdisziplin:",
        f"- Durchschnittliche Zugzeit gesamt: {time_s.get('overall_avg_time', 0.0):.1f}s",
    ]

    pp = time_s.get("phase_pace", {})
    lines.append(
        f"- Tempo nach Phase: Eröffnung {pp.get('opening', {}).get('avg_time', 0.0):.1f}s | "
        f"Mittelspiel {pp.get('middlegame', {}).get('avg_time', 0.0):.1f}s | "
        f"Endspiel {pp.get('endgame', {}).get('avg_time', 0.0):.1f}s"
    )

    for fmt_name in ("Rapid", "Classical"):
        if fmt_name in formats:
            amt = formats[fmt_name].get("avg_move_time", 0.0)
            if 0 < amt < 8.0:
                fmt_label = tr_speed(fmt_name)
                lines.append(
                    f"- KRITISCHE WARNUNG [ZU SCHNELL – {fmt_label.upper()}]: Der Schüler braucht bei Bedenkzeit {fmt_label} im Schnitt nur {amt:.1f}s pro Zug. "
                    f"Er spielt für eine lange Partie viel zu schnell, blitzt Züge impulsiv heraus und beendet Partien mit viel ungenutzter Bedenkzeit, während er patzt."
                )

    qp = time_s.get("quality_pace", {})
    blunder_pace = qp.get("blunder", {}).get("avg_time", 0.0)
    if 0 < blunder_pace < 6.0:
        lines.append(
            f"- Hastige Patzer: Patzer wurden im Schnitt nach {blunder_pace:.1f}s gespielt (impulsive Züge ohne Berechnung)."
        )

    panic_mult = tt.get("panic_multiplier", 1.0)
    if math.isinf(panic_mult):
        lines.append("- Panikfaktor in Zeitnot: Extrem (alle Patzer in Zeitnot begangen)")
    else:
        lines.append(f"- Panikfaktor in Zeitnot: {panic_mult:.1f}x höhere Patzerquote")

    lines.append(f"- Niederlagen durch Zeitüberschreitung: {tt.get('total_time_losses', 0)}")
    return lines


def _openings_section(stats: dict[str, Any]) -> list[str]:
    detailed_ops = stats.get("detailed_openings", {})
    if not detailed_ops:
        return []

    lines = ["\nHighlights des Eröffnungsrepertoires:"]
    sorted_ops = sorted(detailed_ops.values(), key=lambda x: x["total"], reverse=True)
    for op in sorted_ops[:5]:
        lines.append(
            f"- {op['name']} (ECO {op.get('eco', 'k. A.')}): "
            f"{op['total']} Partien, {op['win_rate']:.1f}% Siegquote, {op.get('avg_acc', 0.0):.1f}% Genauigkeit"
        )
    return lines


def build_coach_dossier(stats: dict[str, Any]) -> str:
    """
    Build a compact, high-signal performance dossier from aggregated stats
    specifically tailored for the AI Chess Coach prompt.
    """
    total = stats.get("total", 0)
    if total == 0:
        return "Keine analysierten Partien für die Coaching-Auswertung vorhanden."

    lines: list[str] = []
    lines.extend(_header_section(stats))
    lines.extend(_phase_section(stats))
    lines.extend(_advantage_section(stats))
    lines.extend(_tactics_section(stats))
    lines.extend(_clock_section(stats))
    lines.extend(_openings_section(stats))

    return "\n".join(lines)
