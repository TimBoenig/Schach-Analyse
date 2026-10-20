"""
Playing style estimation from move-level style signals.
"""

from __future__ import annotations

from .features import GameFeatures
from .models import SkillScore, StyleAxis, StyleProfile
from .skills import scale


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def build_style(feats: list[GameFeatures], skills: list[SkillScore]) -> StyleProfile | None:
    games = [f for f in feats if f.user_move_count >= 10]
    if len(games) < 3:
        return None

    moves = sum(f.user_move_count for f in games)
    checks_pm = sum(f.checks for f in games) / moves
    storms_pg = _avg([f.pawn_storm_moves for f in games])
    sacs_pg = _avg(
        [
            float((f.rec.tactics_data or {}).get("tactical_themes", {}).get("sacrifice", 0))
            for f in games
        ]
    )
    motifs_pg = _avg(
        [float(sum((f.rec.tactics_data or {}).get("tactical_themes", {}).values())) for f in games]
    )
    trades_pg = _avg([f.equal_trades for f in games])
    early_queen_trade = _avg(
        [
            1.0 if f.queens_off_by_move is not None and f.queens_off_by_move <= 20 else 0.0
            for f in games
        ]
    )
    finished = [f for f in games if f.score is not None]
    draw_rate = _avg([1.0 if f.rec.is_draw else 0.0 for f in finished])
    volatility = _avg([f.wp_volatility for f in games])
    endgame_rate = _avg([1.0 if f.reached_endgame else 0.0 for f in games])
    clock_fracs = [f.end_clock_fraction for f in games if f.end_clock_fraction is not None]

    aggression = round(
        0.5 * scale(checks_pm, 0.03, 0.14)
        + 0.3 * scale(storms_pg, 0.0, 3.0)
        + 0.2 * scale(sacs_pg, 0.0, 0.4),
        1,
    )
    tactical = scale(motifs_pg, 0.2, 2.0)
    trading = round(0.6 * scale(trades_pg, 2.0, 6.0) + 0.4 * scale(early_queen_trade, 0.1, 0.5), 1)
    risk = round(0.5 * scale(1 - draw_rate, 0.8, 0.98) + 0.5 * scale(volatility, 0.03, 0.09), 1)
    endgame = scale(endgame_rate, 0.2, 0.7)

    axes = [
        StyleAxis("aggression", "Angriffslust", aggression, "abwartend", "angriffslustig"),
        StyleAxis("tactical", "Taktik-Orientierung", tactical, "positionell", "taktisch"),
        StyleAxis("trading", "Tauschfreude", trading, "hält Spannung", "tauscht gern"),
        StyleAxis("risk", "Risikobereitschaft", risk, "sicherheitsorientiert", "riskant"),
        StyleAxis("endgame", "Endspielneigung", endgame, "Entscheidung früh", "spielt lange"),
    ]
    if clock_fracs:
        usage = scale(1 - _avg(clock_fracs), 0.2, 0.9)
        axes.append(StyleAxis("tempo", "Zeitverbrauch", usage, "zügig", "gründlich"))

    skill = {s.key: s for s in skills}
    label, description = _label(aggression, tactical, trading, risk, endgame, skill)

    facts = [
        f"{checks_pm * 40:.1f} Schachgebote pro 40 Züge",
        f"{trades_pg:.1f} gleichwertige Abtausche pro Partie",
        f"Damentausch bis Zug 20 in {early_queen_trade * 100:.0f} % der Partien",
        f"Endspiel erreicht in {endgame_rate * 100:.0f} % der Partien",
        f"Remisquote {draw_rate * 100:.0f} %",
    ]
    castled = [f for f in games if f.castle_side]
    if castled:
        short = sum(1 for f in castled if f.castle_side == "kingside") / len(castled)
        facts.append(
            f"Rochade in {len(castled) / len(games) * 100:.0f} % der Partien "
            f"({short * 100:.0f} % kurz), im Schnitt im {_avg([f.castle_move or 0 for f in castled]):.0f}. Zug"
        )
    return StyleProfile(label=label, description=description, axes=axes, facts=facts)


def _label(
    aggression: float,
    tactical: float,
    trading: float,
    risk: float,
    endgame: float,
    skill: dict[str, SkillScore],
) -> tuple[str, str]:
    eg_skill = skill.get("endgame")
    def_skill = skill.get("defense")
    if aggression >= 60 and tactical >= 50:
        return (
            "Angriffsspieler",
            "Du suchst die Initiative: viele Schachgebote, Bauernstürme und taktische Motive. "
            "Deine Partien werden scharf entschieden. Achte darauf, dass dein eigener König und "
            "deine Figuren dabei sicher bleiben.",
        )
    if tactical >= 60:
        return (
            "Taktiker",
            "Du lebst von konkreten Varianten und taktischen Schlägen. Ruhige, strategische "
            "Stellungen ohne direkte Ziele sind eher Neuland – dort lohnt sich Planungstraining.",
        )
    if endgame >= 60 and eg_skill is not None and eg_skill.score >= 55:
        return (
            "Endspieltechniker",
            "Du spielst Partien gern lange und bist im Endspiel sicher unterwegs. Vereinfachen, "
            "wenn du besser stehst, ist für dich eine gute Strategie.",
        )
    if trading >= 60 and risk < 50:
        return (
            "Solider Positionsspieler",
            "Du tauschst gern ab und vermeidest unnötige Risiken. Das macht dich schwer zu "
            "schlagen; gegen schwächere Gegner fehlt manchmal der Druck, um zu gewinnen.",
        )
    if def_skill is not None and def_skill.reliable and def_skill.score >= 60:
        return (
            "Kämpfer",
            "Auch in schlechteren Stellungen gibst du nicht auf und rettest überdurchschnittlich "
            "oft noch Punkte.",
        )
    if risk >= 65:
        return (
            "Risikospieler",
            "Deine Partien schwanken stark – du gehst Risiken ein und Remis sind selten. "
            "Mehr Stabilität in kritischen Momenten bringt dir schnell Punkte.",
        )
    return (
        "Universalspieler",
        "Dein Stil ist ausgewogen: weder ausgesprochen aggressiv noch übervorsichtig. "
        "Die Profilwerte unten zeigen, wo du dich gezielt weiterentwickeln kannst.",
    )
