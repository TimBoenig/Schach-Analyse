"""
German display labels for internal domain keys.

Internal keys (classification names, phases, speed categories, filter values,
termination types) stay in English because they are persisted in SQLite and
compared in logic. Only the presentation layer maps them to German through
these helpers, so stored data stays compatible across versions.
"""

from __future__ import annotations

CLASSIFICATION_LABELS: dict[str, str] = {
    "Brilliant": "Brillant",
    "Great": "Großartig",
    "Best": "Bester Zug",
    "Excellent": "Exzellent",
    "Good": "Gut",
    "Inaccuracy": "Ungenauigkeit",
    "Mistake": "Fehler",
    "Blunder": "Patzer",
    "Miss": "Verpasst",
    "Book": "Buchzug",
    "Forced": "Erzwungen",
    "Clean Game": "Fehlerfreie Partie",
    "Lost Lead": "Vorteil verspielt",
    "Drawn Lead": "Vorteil nur remis",
    "Comeback": "Aufholjagd",
    "Comeback Win": "Sieg nach Rückstand",
    "Comeback Draw": "Remis nach Rückstand",
}

PHASE_LABELS: dict[str, str] = {
    "opening": "Eröffnung",
    "middlegame": "Mittelspiel",
    "endgame": "Endspiel",
}

# Dative form for sentences like "Fehler im Mittelspiel" / "in der Eröffnung".
PHASE_IN_LABELS: dict[str, str] = {
    "opening": "in der Eröffnung",
    "middlegame": "im Mittelspiel",
    "endgame": "im Endspiel",
}

COLOR_LABELS: dict[str, str] = {
    "white": "Weiß",
    "black": "Schwarz",
}

PIECE_LABELS: dict[str, str] = {
    "pawn": "Bauer",
    "knight": "Springer",
    "bishop": "Läufer",
    "rook": "Turm",
    "queen": "Dame",
    "king": "König",
}

PIECE_LABELS_PLURAL: dict[str, str] = {
    "pawn": "Bauern",
    "knight": "Springer",
    "bishop": "Läufer",
    "rook": "Türme",
    "queen": "Damen",
    "king": "Könige",
}

MOTIF_LABELS: dict[str, str] = {
    "fork": "Gabel",
    "pin": "Fesselung",
    "skewer": "Spieß",
    "discovered_attack": "Abzugsangriff",
    "sacrifice": "Opfer",
    "back_rank": "Grundreihe",
}

SPEED_LABELS: dict[str, str] = {
    "UltraBullet": "UltraBullet",
    "Bullet": "Bullet",
    "Blitz": "Blitz",
    "Rapid": "Schnellschach",
    "Classical": "Klassisch",
    "Daily": "Fernschach",
    "Correspondence": "Fernschach",
    "Chess960": "Chess960",
    "Other": "Sonstige",
    "Unknown": "Unbekannt",
    "Standard": "Standard",
}

TERMINATION_LABELS: dict[str, str] = {
    "Checkmate": "Schachmatt",
    "Resignation": "Aufgabe",
    "Time": "Zeitüberschreitung",
    "Abandon": "Abbruch",
    "Draw": "Remis",
    "3-Fold Repetition": "Dreifache Wiederholung",
    "Agreement": "Einigung",
    "Stalemate": "Patt",
    "Insufficient vs Timeout": "Zeit vs. ungenügendes Material",
    "Insufficient Material": "Ungenügendes Material",
    "50-Move Rule": "50-Züge-Regel",
}

OUTCOME_LABELS: dict[str, str] = {
    "win": "Sieg",
    "draw": "Remis",
    "loss": "Niederlage",
}

# Filter option values are stored/compared in English; these are their labels.
FILTER_LABELS: dict[str, str] = {
    "All Colors": "Alle Farben",
    "White": "Weiß",
    "Black": "Schwarz",
    "All Formats": "Alle Formate",
    "Freestyle (Chess960)": "Freestyle (Chess960)",
    "All Sources": "Alle Quellen",
    "Chess.com": "Chess.com",
    "Lichess": "Lichess",
    "File": "Datei",
    "PGN File": "PGN-Datei",
    "All Time": "Gesamter Zeitraum",
    "Last 24 Hours": "Letzte 24 Stunden",
    "Last 7 Days": "Letzte 7 Tage",
    "Last 30 Days": "Letzte 30 Tage",
    "Last 90 Days": "Letzte 90 Tage",
    "This Year": "Dieses Jahr",
    **SPEED_LABELS,
}


def _lookup(table: dict[str, str], key: str | None) -> str:
    if not key:
        return ""
    if key in table:
        return table[key]
    lowered = key.lower()
    for k, v in table.items():
        if k.lower() == lowered:
            return v
    return key


def tr_classification(key: str | None) -> str:
    """German label for a move classification (falls back to the key itself)."""
    return _lookup(CLASSIFICATION_LABELS, key)


def tr_phase(key: str | None) -> str:
    return _lookup(PHASE_LABELS, key)


def tr_phase_in(key: str | None) -> str:
    return _lookup(PHASE_IN_LABELS, key)


def tr_color(key: str | None) -> str:
    return _lookup(COLOR_LABELS, key)


def tr_piece(key: str | None, plural: bool = False) -> str:
    return _lookup(PIECE_LABELS_PLURAL if plural else PIECE_LABELS, key)


def tr_motif(key: str | None) -> str:
    return _lookup(MOTIF_LABELS, key)


def tr_speed(key: str | None) -> str:
    return _lookup(SPEED_LABELS, key)


def tr_termination(key: str | None) -> str:
    return _lookup(TERMINATION_LABELS, key)


def tr_outcome(key: str | None) -> str:
    return _lookup(OUTCOME_LABELS, key)


def tr_filter(key: str | None) -> str:
    return _lookup(FILTER_LABELS, key)


# Board theme names are persisted as config values ("board_theme"); only the
# combo box labels are localized.
BOARD_THEME_LABELS: dict[str, str] = {
    "Green": "Grün",
    "Blue": "Blau",
    "Brown": "Braun",
    "Gray": "Grau",
    "Purple": "Lila",
    "Teal": "Türkis",
    "Cherry": "Kirsche",
    "Neon": "Neon",
}


def tr_board_theme(key: str | None) -> str:
    return _lookup(BOARD_THEME_LABELS, key)
