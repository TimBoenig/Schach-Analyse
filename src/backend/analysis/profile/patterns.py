"""
Recurring pattern detection across many games.

Every detector returns a Pattern with a German explanation, a severity and
concrete example positions so the user can jump straight into the games
where the pattern happened.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable

from src.utils.translations import tr_classification, tr_color, tr_phase_in, tr_piece

from .features import GameFeatures, MoveEvent, move_label
from .models import GameRef, Pattern

MAX_EXAMPLES = 8
# Two games belong to the same session when they start less than 90 minutes apart.
SESSION_GAP_SECONDS = 90 * 60
MIN_ERRORS_FOR_SHARE = 8


def _ref(f: GameFeatures, m: MoveEvent | None = None, detail: str = "") -> GameRef:
    opp = f.rec.opp_name
    when = f.date or ""
    if m is None:
        return GameRef(game_id=f.game_id, label=f"gegen {opp} ({when})", detail=detail)
    label = f"{move_label(m.move_number, f.rec.user_color == 'white', m.san)} gegen {opp}"
    return GameRef(
        game_id=f.game_id,
        ply_index=m.ply_index,
        label=label,
        detail=detail or f"{tr_classification(m.classification)} · {when}",
    )


def _examples(
    feats: list[GameFeatures], pred: Callable[[MoveEvent], bool], limit: int = MAX_EXAMPLES
) -> list[GameRef]:
    refs: list[GameRef] = []
    for f in sorted(feats, key=lambda x: x.played_at or 0, reverse=True):
        for m in f.moves:
            if pred(m):
                refs.append(_ref(f, m))
                break
        if len(refs) >= limit:
            break
    return refs


def _severity(share: float, high: float, mid: float) -> str:
    if share >= high:
        return "hoch"
    if share >= mid:
        return "mittel"
    return "niedrig"


def detect_patterns(feats: list[GameFeatures]) -> list[Pattern]:
    analyzed = [f for f in feats if f.analyzed]
    patterns: list[Pattern] = []
    if not analyzed:
        return patterns

    serious = [(f, m) for f in analyzed for m in f.moves if m.is_serious_error]
    n_serious = len(serious)

    # 1) Errors in winning positions (complacency / "Gewinnstellung vergeben").
    winning_err = [x for x in serious if x[1].wp_before >= 0.70]
    if n_serious >= MIN_ERRORS_FOR_SHARE and winning_err:
        share = len(winning_err) / n_serious
        if share >= 0.20:
            patterns.append(
                Pattern(
                    key="errors_when_winning",
                    title="Fehler in Gewinnstellungen",
                    text=(
                        f"{share * 100:.0f} % deiner Fehler und Patzer passieren, wenn du bereits "
                        "klar besser stehst. Typisch: zu schnelles Spiel oder Sorglosigkeit, sobald "
                        "die Partie 'gewonnen' scheint."
                    ),
                    severity=_severity(share, 0.35, 0.2),
                    value=share,
                    examples=_examples(
                        analyzed, lambda m: m.is_serious_error and m.wp_before >= 0.7
                    ),
                )
            )

    # 2) Errors in worse positions (panic / collapse under pressure).
    losing_err = [x for x in serious if x[1].wp_before <= 0.30]
    if n_serious >= MIN_ERRORS_FOR_SHARE and losing_err:
        share = len(losing_err) / n_serious
        if share >= 0.30:
            patterns.append(
                Pattern(
                    key="errors_under_pressure",
                    title="Einbruch unter Druck",
                    text=(
                        f"{share * 100:.0f} % deiner schweren Fehler entstehen in schlechteren "
                        "Stellungen. Statt zäh zu verteidigen, folgt oft der nächste Fehler."
                    ),
                    severity=_severity(share, 0.45, 0.3),
                    value=share,
                    examples=_examples(
                        analyzed, lambda m: m.is_serious_error and m.wp_before <= 0.3
                    ),
                )
            )

    # 3) Missing opponent mistakes.
    chances = sum(f.punish_chances for f in analyzed)
    punished = sum(f.punished for f in analyzed)
    if chances >= 6:
        rate = punished / chances
        if rate < 0.6:
            patterns.append(
                Pattern(
                    key="missed_punish",
                    title="Gegnerfehler nicht bestraft",
                    text=(
                        f"Nach einem Fehler deines Gegners findest du nur in {rate * 100:.0f} % der "
                        "Fälle die Widerlegung. Frage dich nach jedem gegnerischen Zug: "
                        "'Was hat sich verändert, was hängt jetzt?'"
                    ),
                    severity=_severity(1 - rate, 0.55, 0.4),
                    value=rate,
                    examples=_examples(
                        analyzed,
                        lambda m: m.after_opponent_error and m.wp_drop >= 0.10,
                    ),
                )
            )
        elif rate >= 0.8:
            patterns.append(
                Pattern(
                    key="punisher",
                    title="Gegnerfehler werden bestraft",
                    text=(
                        f"Du nutzt {rate * 100:.0f} % der gegnerischen Fehler direkt aus – "
                        "ein starkes taktisches Auge."
                    ),
                    severity="positiv",
                    value=rate,
                )
            )

    # 4) Rushed blunders (fast moves that lose a lot).
    timed = [x for x in serious if x[1].time_spent is not None]
    if len(timed) >= MIN_ERRORS_FOR_SHARE:
        fast = [x for x in timed if (x[1].time_spent or 0) < 3.0 and not x[1].in_time_trouble]
        share = len(fast) / len(timed)
        if share >= 0.35:
            patterns.append(
                Pattern(
                    key="hasty_errors",
                    title="Schnellschüsse",
                    text=(
                        f"{share * 100:.0f} % deiner schweren Fehler hast du in unter 3 Sekunden "
                        "gespielt – obwohl du nicht in Zeitnot warst. Ein kurzer Sicherheitscheck "
                        "vor dem Ziehen würde viele davon verhindern."
                    ),
                    severity=_severity(share, 0.5, 0.35),
                    value=share,
                    examples=_examples(
                        analyzed,
                        lambda m: (
                            m.is_serious_error
                            and m.time_spent is not None
                            and m.time_spent < 3.0
                            and not m.in_time_trouble
                        ),
                    ),
                )
            )

        trouble = [x for x in timed if x[1].in_time_trouble]
        share_t = len(trouble) / len(timed)
        if share_t >= 0.3:
            patterns.append(
                Pattern(
                    key="time_trouble_errors",
                    title="Fehler in Zeitnot",
                    text=(
                        f"{share_t * 100:.0f} % deiner schweren Fehler passieren in Zeitnot. "
                        "Du verbrauchst zu viel Zeit in früheren Phasen der Partie."
                    ),
                    severity=_severity(share_t, 0.45, 0.3),
                    value=share_t,
                    examples=_examples(
                        analyzed, lambda m: m.is_serious_error and m.in_time_trouble
                    ),
                )
            )

    # 5) Errors right after leaving opening theory.
    if n_serious >= MIN_ERRORS_FOR_SHARE:
        early = [x for x in serious if 0 <= x[1].moves_since_book < 4 and x[1].move_number <= 15]
        games_with_early = len({f.game_id for f, _ in early})
        share_games = games_with_early / len(analyzed)
        if share_games >= 0.2:
            patterns.append(
                Pattern(
                    key="post_book_errors",
                    title="Fehler direkt nach der Theorie",
                    text=(
                        f"In {share_games * 100:.0f} % deiner Partien folgt ein schwerer Fehler "
                        "innerhalb von 4 Zügen nach Verlassen der Eröffnungstheorie. Lerne nicht nur "
                        "Züge, sondern die typischen Pläne deiner Eröffnungen."
                    ),
                    severity=_severity(share_games, 0.35, 0.2),
                    value=share_games,
                    examples=_examples(
                        analyzed,
                        lambda m: (
                            m.is_serious_error
                            and 0 <= m.moves_since_book < 4
                            and m.move_number <= 15
                        ),
                    ),
                )
            )

    # 6) Phase where most serious errors happen.
    if n_serious >= MIN_ERRORS_FOR_SHARE:
        phase_moves = Counter(m.phase for f in analyzed for m in f.moves if not m.is_book)
        phase_err = Counter(m.phase for _, m in serious)
        rates = {p: phase_err[p] / phase_moves[p] for p in phase_moves if phase_moves[p] >= 30}
        if len(rates) >= 2:
            worst = max(rates, key=lambda p: rates[p])
            best = min(rates, key=lambda p: rates[p])
            if rates[best] > 0 and rates[worst] / rates[best] >= 1.6:
                patterns.append(
                    Pattern(
                        key=f"phase_{worst}",
                        title=f"Fehlerhäufung {tr_phase_in(worst)}",
                        text=(
                            f"{tr_phase_in(worst).capitalize()} machst du {rates[worst] * 100:.1f} "
                            f"schwere Fehler pro 100 Züge – {rates[worst] / rates[best]:.1f}× so viele "
                            f"wie {tr_phase_in(best)}."
                        ),
                        severity="mittel",
                        value=rates[worst],
                        examples=_examples(
                            analyzed, lambda m, w=worst: m.is_serious_error and m.phase == w
                        ),
                    )
                )

    patterns.extend(_hung_piece_pattern(analyzed))
    patterns.extend(_session_patterns(feats))
    patterns.extend(_opponent_strength_pattern(feats))
    patterns.extend(_castling_pattern(feats))

    order = {"hoch": 0, "mittel": 1, "niedrig": 2, "positiv": 3}
    patterns.sort(key=lambda p: (order.get(p.severity, 9), -p.value))
    return patterns


def _hung_piece_pattern(analyzed: list[GameFeatures]) -> list[Pattern]:
    counts: Counter[str] = Counter()
    for f in analyzed:
        for p, c in (
            (f.rec.tactics_data or {}).get("hanging_metrics", {}).get("by_piece", {}).items()
        ):
            counts[p] += c
    total = sum(counts.values())
    if total < 5:
        return []
    piece, cnt = counts.most_common(1)[0]
    share = cnt / total
    if share < 0.35:
        return []
    examples: list[GameRef] = []
    for f in analyzed:
        for h in (f.rec.tactics_data or {}).get("hung_pieces_details", []):
            if str(h.get("piece_name", "")).lower() == piece:
                examples.append(
                    GameRef(
                        game_id=f.game_id,
                        ply_index=max(0, int(h.get("ply", 1)) - 1),
                        label=f"{h.get('san', '')} gegen {f.rec.opp_name}",
                        detail=f"{tr_piece(piece)} eingestellt · {f.date}",
                    )
                )
                break
        if len(examples) >= MAX_EXAMPLES:
            break
    return [
        Pattern(
            key="hung_piece_type",
            title=f"Häufig eingestellt: {tr_piece(piece)}",
            text=(
                f"{share * 100:.0f} % deiner eingestellten Figuren sind {tr_piece(piece, plural=True)} "
                f"({cnt} von {total}). Prüfe vor jedem Zug besonders, ob diese Figur gedeckt ist."
            ),
            severity=_severity(share, 0.5, 0.35),
            value=share,
            examples=examples,
        )
    ]


def _sessions(feats: list[GameFeatures]) -> list[list[GameFeatures]]:
    timed = sorted((f for f in feats if f.played_at), key=lambda f: f.played_at or 0)
    sessions: list[list[GameFeatures]] = []
    for f in timed:
        if (
            sessions
            and (f.played_at or 0) - (sessions[-1][-1].played_at or 0) <= SESSION_GAP_SECONDS
        ):
            sessions[-1].append(f)
        else:
            sessions.append([f])
    return sessions


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _session_patterns(feats: list[GameFeatures]) -> list[Pattern]:
    out: list[Pattern] = []
    sessions = _sessions(feats)

    # Tilt: results of the game right after a loss within the same session.
    after_loss: list[float] = []
    overall: list[float] = []
    for s in sessions:
        for i, f in enumerate(s):
            if f.score is None:
                continue
            overall.append(f.score)
            if i > 0 and s[i - 1].rec.is_loss:
                after_loss.append(f.score)
    if len(after_loss) >= 8 and overall:
        base = _avg(overall)
        tilt = _avg(after_loss)
        if base - tilt >= 0.08:
            out.append(
                Pattern(
                    key="tilt",
                    title="Tilt nach Niederlagen",
                    text=(
                        f"Direkt nach einer Niederlage holst du nur {tilt * 100:.0f} % der Punkte "
                        f"(sonst {base * 100:.0f} %). Nach einer Niederlage lohnt sich eine Pause, "
                        "statt sofort die nächste Partie zu starten."
                    ),
                    severity="hoch" if base - tilt >= 0.15 else "mittel",
                    value=base - tilt,
                )
            )
        elif tilt >= base + 0.03:
            out.append(
                Pattern(
                    key="resilient",
                    title="Mental stabil nach Niederlagen",
                    text=(
                        f"Nach einer Niederlage spielst du sogar besser ({tilt * 100:.0f} % der "
                        f"Punkte gegenüber {base * 100:.0f} % im Schnitt)."
                    ),
                    severity="positiv",
                    value=tilt - base,
                )
            )

    # Fatigue: accuracy in long sessions (4th game onwards) vs the first games.
    early_acc = [f.rec.game_acc for s in sessions for f in s[:3] if f.analyzed]
    late_acc = [f.rec.game_acc for s in sessions for f in s[3:] if f.analyzed]
    if len(late_acc) >= 6 and len(early_acc) >= 6:
        drop = _avg(early_acc) - _avg(late_acc)
        if drop >= 3.0:
            out.append(
                Pattern(
                    key="fatigue",
                    title="Nachlassen in langen Sessions",
                    text=(
                        f"Ab der 4. Partie einer Session sinkt deine Genauigkeit um "
                        f"{drop:.1f} Prozentpunkte. Begrenze Sessions auf 3 Partien."
                    ),
                    severity="mittel",
                    value=drop,
                )
            )
    return out


def _opponent_strength_pattern(feats: list[GameFeatures]) -> list[Pattern]:
    weaker: list[float] = []
    for f in feats:
        if f.score is None or not f.user_rating or not f.opp_rating:
            continue
        if f.opp_rating <= f.user_rating - 100:
            weaker.append(f.score)
    if len(weaker) >= 8:
        score = _avg(weaker)
        if score < 0.62:
            return [
                Pattern(
                    key="weaker_opponents",
                    title="Punktverluste gegen schwächere Gegner",
                    text=(
                        f"Gegen Gegner mit mindestens 100 Punkten weniger holst du nur "
                        f"{score * 100:.0f} % der Punkte (erwartet wären ca. 64 % oder mehr). "
                        "Unterschätze niemanden – spiele auch hier jeden Zug mit voller Sorgfalt."
                    ),
                    severity="mittel",
                    value=0.64 - score,
                )
            ]
    return []


def _castling_pattern(feats: list[GameFeatures]) -> list[Pattern]:
    late = [f for f in feats if f.score is not None and f.plies >= 30 and f.castle_side is None]
    on_time = [
        f
        for f in feats
        if f.score is not None and f.castle_move is not None and f.castle_move <= 10
    ]
    if len(late) >= 6 and len(on_time) >= 6:
        late_score = _avg([f.score or 0.0 for f in late])
        ok_score = _avg([f.score or 0.0 for f in on_time])
        if ok_score - late_score >= 0.12:
            return [
                Pattern(
                    key="king_safety",
                    title="Ohne Rochade schlechtere Ergebnisse",
                    text=(
                        f"In Partien ohne Rochade holst du {late_score * 100:.0f} % der Punkte, "
                        f"mit früher Rochade {ok_score * 100:.0f} %. Bring deinen König früher in "
                        "Sicherheit."
                    ),
                    severity="mittel",
                    value=ok_score - late_score,
                    examples=[
                        _ref(f, detail=f"als {tr_color(f.rec.user_color)}") for f in late[:6]
                    ],
                )
            ]
    return []
