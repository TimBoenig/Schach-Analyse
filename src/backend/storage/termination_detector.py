import chess

from .models import MoveAnalysis


class TerminationDetector:
    """
    Detects the game termination mode and produces human-readable (German)
    descriptions matching online chess platforms (Chess.com / Lichess).

    The description is stored as the game's termination text and may be fed back
    in as the "Termination" header for legacy rows without a termination_mode, so
    the header keyword checks below also recognise the German descriptions.
    """

    @staticmethod
    def detect_termination(
        headers: dict,
        moves: list[MoveAnalysis],
        starting_fen: str | None = None,
        chess960: bool = False,
    ) -> tuple[str, str]:
        """
        Returns (termination_mode, termination_description).
        """
        result = headers.get("Result", "*").strip()
        header_term = headers.get("Termination", "").strip()
        term_lower = header_term.lower()

        # Replay board state to check physical terminal rules
        board = chess.Board(starting_fen) if starting_fen else chess.Board(chess960=chess960)
        for m in moves:
            try:
                board.push_uci(m.uci)
            except Exception:
                break

        winner_name = None
        if result == "1-0":
            winner_name = headers.get("White", "Weiß")
        elif result == "0-1":
            winner_name = headers.get("Black", "Schwarz")

        # 1. Authoritative Board States
        if board.is_checkmate():
            if result == "1-0":
                return "checkmate", f"{headers.get('White', 'Weiß')} gewinnt durch Schachmatt"
            elif result == "0-1":
                return "checkmate", f"{headers.get('Black', 'Schwarz')} gewinnt durch Schachmatt"
            return "checkmate", "Partie durch Schachmatt entschieden"

        if board.is_stalemate():
            return "stalemate", "Remis durch Patt"

        if board.is_insufficient_material():
            return "insufficient_material", "Remis durch ungenügendes Material"

        if (
            board.is_fivefold_repetition()
            or board.can_claim_threefold_repetition()
            or board.is_repetition(3)
        ):
            return "threefold_repetition", "Remis durch Stellungswiederholung"

        if board.is_seventyfive_moves() or board.can_claim_fifty_moves() or board.is_fifty_moves():
            return "fifty_moves", "Remis durch 50-Züge-Regel"

        # 2. Explicit PGN Headers (Chess.com / Lichess strings)
        if "resign" in term_lower or "aufgabe" in term_lower:
            if winner_name:
                return "resignation", f"{winner_name} gewinnt durch Aufgabe"
            return "resignation", "Partie durch Aufgabe entschieden"

        if any(kw in term_lower for kw in ("time", "clock", "timeout", "flag", "forfeit", "zeit")):
            # Check for timeout vs insufficient material
            if result in ("1/2-1/2", "Draw"):
                return (
                    "timeout_insufficient",
                    "Remis durch Zeitüberschreitung (ungenügendes Material)",
                )
            if winner_name:
                return "timeout", f"{winner_name} gewinnt durch Zeitüberschreitung"
            return "timeout", "Partie durch Zeitüberschreitung entschieden"

        if any(
            kw in term_lower for kw in ("abandoned", "disconnected", "left the game", "abgebrochen")
        ):
            if winner_name:
                return "abandonment", f"{winner_name} gewinnt – Partie abgebrochen"
            return "abandonment", "Partie abgebrochen"

        if any(kw in term_lower for kw in ("rules", "cheat", "disqualif", "regelverstoß")):
            if winner_name:
                return "rules_violation", f"{winner_name} gewinnt durch Regelverstoß"
            return "rules_violation", "Partie durch Regelverstoß entschieden"

        if "repetition" in term_lower or "wiederholung" in term_lower:
            return "threefold_repetition", "Remis durch Stellungswiederholung"

        if any(kw in term_lower for kw in ("50-move", "fifty-move", "50-züge")):
            return "fifty_moves", "Remis durch 50-Züge-Regel"

        if "insufficient" in term_lower or "ungenügend" in term_lower:
            return "insufficient_material", "Remis durch ungenügendes Material"

        if any(kw in term_lower for kw in ("agreed", "agreement", "mutual", "einigung")):
            return "agreed_draw", "Remis durch Einigung"

        # 3. Fallback when Header is Missing or Generic ("Normal")
        if moves:
            # Check if losing player timed out (clock == 0)
            if result == "1-0":
                # Black lost. If Black's last clock is 0, it's a timeout.
                # Find Black's last move clock
                black_clks = [
                    m.time_left for m in moves if m.ply % 2 == 0 and m.time_left is not None
                ]
                if black_clks and black_clks[-1] == 0:
                    return (
                        "timeout",
                        f"{headers.get('White', 'Weiß')} gewinnt durch Zeitüberschreitung",
                    )
            elif result == "0-1":
                # White lost. Find White's last move clock
                white_clks = [
                    m.time_left for m in moves if m.ply % 2 == 1 and m.time_left is not None
                ]
                if white_clks and white_clks[-1] == 0:
                    return (
                        "timeout",
                        f"{headers.get('Black', 'Schwarz')} gewinnt durch Zeitüberschreitung",
                    )

        # Result-based fallback
        if result == "1-0":
            return "resignation", f"{headers.get('White', 'Weiß')} gewinnt durch Aufgabe"
        elif result == "0-1":
            return "resignation", f"{headers.get('Black', 'Schwarz')} gewinnt durch Aufgabe"
        elif result in ("1/2-1/2", "Draw"):
            return "agreed_draw", "Remis durch Einigung"

        return "unterminated", "Partie nicht beendet"
