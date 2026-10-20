"""
Personal training plan derived from weak skills and detected patterns.
"""

from __future__ import annotations

from typing import Any

from src.utils.translations import tr_motif

from .models import Pattern, SkillScore, TrainingItem

_SKILL_PLANS: dict[str, tuple[str, list[str]]] = {
    "safety": (
        "Blunder-Check zur Gewohnheit machen",
        [
            "Vor jedem Zug drei Fragen: Welche Schachs, Schläge und Drohungen hat mein Gegner danach?",
            "Prüfe nach jedem gegnerischen Zug, welche deiner Figuren angegriffen oder ungedeckt sind.",
            "Spiele für zwei Wochen nur Schnellschach (mind. 10 Minuten), um den Check zu verinnerlichen.",
            "Löse im Bereich 'Eigene Fehler' die Stellungen, in denen du Material eingestellt hast.",
        ],
    ),
    "tactics": (
        "Taktisches Sehen schärfen",
        [
            "Täglich 15–20 Minuten Taktikaufgaben (z. B. chess.com Puzzles oder Lichess Puzzle-Themen).",
            "Nach jedem gegnerischen Zug fragen: 'Was ist jetzt anders – hängt etwas, steht etwas auf einer Linie?'",
            "Trainiere gezielt Motive, die du selten findest: {motifs}.",
            "Wiederhole die Stellungen aus 'Eigene Fehler', in denen du eine Chance verpasst hast.",
        ],
    ),
    "opening": (
        "Eröffnungsrepertoire festigen",
        [
            "Beschränke dich auf ein Repertoire: eine Eröffnung mit Weiß, je eine Antwort auf 1.e4 und 1.d4.",
            "Lerne zu jeder Eröffnung die typischen Pläne und Bauernstrukturen, nicht nur die Züge.",
            "Schau dir nach jeder Partie an, wo du die Theorie verlassen hast (Explorer-Ansicht).",
            "Arbeite zuerst an deiner schwächsten Eröffnung: {worst_opening}.",
        ],
    ),
    "middlegame": (
        "Mittelspiel: Pläne statt Einzelzüge",
        [
            "Formuliere in jeder ruhigen Stellung einen Plan: schwächste gegnerische Figur, beste Felder für deine Figuren.",
            "Spiele kommentierte Meisterpartien in deiner Eröffnung nach und rate den nächsten Zug.",
            "Analysiere deine Mittelspielfehler mit der Engine – welche Idee hast du übersehen?",
        ],
    ),
    "endgame": (
        "Endspieltechnik aufbauen",
        [
            "Lerne die Grundendspiele: Opposition, Quadratregel, Lucena- und Philidor-Stellung.",
            "Übe Turmendspiele – sie kommen in deinen Partien am häufigsten vor.",
            "Spiele gewonnene Endspiele aus deinen Partien gegen die Engine zu Ende.",
            "Aktiviere im Endspiel deinen König frühzeitig.",
        ],
    ),
    "conversion": (
        "Gewinnstellungen sicher verwerten",
        [
            "In Gewinnstellungen: Figuren tauschen, Bauern behalten, Gegenspiel verhindern.",
            "Nimm dir bei klarem Vorteil bewusst mehr Zeit – die meisten Rückschläge entstehen durch Hast.",
            "Spiele Stellungen mit +3 aus deinen Partien gegen die Engine zu Ende.",
        ],
    ),
    "defense": (
        "Zähe Verteidigung trainieren",
        [
            "Gib schlechtere Stellungen nicht verloren: suche aktives Gegenspiel statt passiver Verteidigung.",
            "Stelle dem Gegner praktische Probleme: Komplikationen, Festungsideen, Dauerschach.",
            "Lerne typische Remis-Festungen (falsche Läufer + Randbauer, Turm gegen Turm + Bauer).",
        ],
    ),
    "time": (
        "Zeiteinteilung verbessern",
        [
            "Faustregel: nach 20 Zügen sollte noch mindestens die Hälfte der Bedenkzeit übrig sein.",
            "Spiele Eröffnungszüge, die du kennst, zügig – investiere die Zeit in kritische Momente.",
            "In Zeitnot: einfache, sichere Züge statt tiefer Berechnung; nutze das Inkrement.",
        ],
    ),
    "consistency": (
        "Konstanter spielen",
        [
            "Feste Routine vor jeder Partie: ausgeruht spielen, keine Partien 'nebenbei'.",
            "Begrenze Sessions auf wenige Partien und mache nach Niederlagen eine Pause.",
            "Nutze in jeder Partie denselben Denkprozess (Drohungen, Kandidatenzüge, Blunder-Check).",
        ],
    ),
}

_PATTERN_PLANS: dict[str, tuple[str, list[str]]] = {
    "tilt": (
        "Tilt vermeiden",
        [
            "Nach einer Niederlage: mindestens 10 Minuten Pause, bevor die nächste Partie startet.",
            "Lege dir eine Stopp-Regel fest, z. B. zwei Niederlagen in Folge = Session beenden.",
        ],
    ),
    "hasty_errors": (
        "Langsamer ziehen in kritischen Momenten",
        [
            "Setz dich auf die Hände: Erst ziehen, wenn der Blunder-Check abgeschlossen ist.",
            "Spiele ein paar Partien mit längerer Bedenkzeit, um ruhiger zu werden.",
        ],
    ),
    "errors_when_winning": (
        "Konzentration halten, wenn du besser stehst",
        [
            "Frage dich in Gewinnstellungen: 'Was ist das einzige, womit der Gegner noch zurückkommen kann?'",
            "Kein 'Hoffnungsschach' des Gegners zulassen – erst Gegenspiel stoppen, dann gewinnen.",
        ],
    ),
    "fatigue": (
        "Kürzere Spiel-Sessions",
        ["Spiele maximal 3 Partien am Stück; deine Genauigkeit sinkt danach messbar."],
    ),
    "post_book_errors": (
        "Pläne nach der Eröffnung kennen",
        [
            "Schau dir für deine Haupteröffnungen 3–5 Meisterpartien bis Zug 25 an.",
            "Notiere dir für jede Eröffnung die typischen Pläne für beide Seiten.",
        ],
    ),
}


def build_training_plan(
    skills: list[SkillScore],
    patterns: list[Pattern],
    stats: dict[str, Any],
    worst_opening: str = "",
) -> list[TrainingItem]:
    items: list[TrainingItem] = []
    themes = stats.get("tactical_themes", {}) or {}
    rare = sorted(themes, key=lambda k: themes[k])[:2] if themes else ["fork", "pin"]
    motifs = ", ".join(tr_motif(m) for m in rare)

    reliable = sorted((s for s in skills if s.reliable), key=lambda s: s.score)
    for s in reliable[:3]:
        if s.score >= 70 or s.key not in _SKILL_PLANS:
            continue
        title, steps = _SKILL_PLANS[s.key]
        items.append(
            TrainingItem(
                priority=0,
                title=title,
                reason=f"{s.name}: {s.score:.0f}/100 ({s.grade}) – {s.detail}.",
                steps=[
                    st.format(
                        motifs=motifs, worst_opening=worst_opening or "deine häufigste Eröffnung"
                    )
                    for st in steps
                ],
                focus_skill=s.key,
            )
        )

    for p in patterns:
        if p.severity not in ("hoch", "mittel") or p.key not in _PATTERN_PLANS:
            continue
        title, steps = _PATTERN_PLANS[p.key]
        items.append(
            TrainingItem(
                priority=0,
                title=title,
                reason=p.text,
                steps=list(steps),
                examples=list(p.examples[:5]),
            )
        )
        if len(items) >= 6:
            break

    for i, item in enumerate(items, start=1):
        item.priority = i
    return items
