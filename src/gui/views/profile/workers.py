"""
Background workers for the profile page. They only bridge backend services
to Qt signals; all computation lives in src/backend.
"""

from __future__ import annotations

import threading

from PyQt6.QtCore import QThread, pyqtSignal

from src.backend.analysis.analyzer import Analyzer
from src.backend.analysis.engine import EngineManager
from src.backend.analysis.profile import build_player_profile
from src.backend.services.game_import_service import (
    analyze_games,
    import_chesscom_games,
    import_pgn_text,
    pending_game_ids,
)
from src.backend.storage.game_history import GameHistoryManager
from src.utils.logger import logger

# Engine time per move for the batch modes. "Schnell" keeps a 100-game import
# within a reasonable evening on a laptop; "Gründlich" uses the user's settings.
BATCH_SPEEDS: dict[str, float | None] = {
    "Schnell (0,1 s/Zug)": 0.1,
    "Standard (0,3 s/Zug)": 0.3,
    "Gründlich (Einstellungen)": None,
}


class ProfileWorker(QThread):
    finished = pyqtSignal(object)  # PlayerProfile
    error = pyqtSignal(str)

    def __init__(self, usernames: list[str], format_filter: str, date_filter: str):
        super().__init__()
        self.usernames = usernames
        self.format_filter = format_filter
        self.date_filter = date_filter

    def run(self):
        try:
            history = GameHistoryManager()
            games = history.get_games_for_stats(self.usernames)
            profile = build_player_profile(
                games,
                self.usernames,
                format_filter=self.format_filter,
                date_filter=self.date_filter,
            )
            self.finished.emit(profile)
        except Exception as e:
            logger.error("ProfileWorker failed: %s", e, exc_info=True)
            self.error.emit(str(e))


class ImportWorker(QThread):
    """Imports games from chess.com (username) or from PGN text into the history."""

    progress = pyqtSignal(int, int, str)
    finished = pyqtSignal(object)  # ImportResult
    error = pyqtSignal(str)

    def __init__(self, username: str = "", months: int | None = 6, pgn_text: str = ""):
        super().__init__()
        self.username = username
        self.months = months
        self.pgn_text = pgn_text
        self._cancel = threading.Event()

    def cancel(self):
        self._cancel.set()

    def run(self):
        try:
            history = GameHistoryManager()
            if self.pgn_text:
                result = import_pgn_text(history, self.pgn_text)
            else:
                result = import_chesscom_games(
                    history,
                    self.username,
                    months=self.months,
                    progress=lambda i, n, label: self.progress.emit(i, n, label),
                    cancel=self._cancel,
                )
            self.finished.emit(result)
        except Exception as e:
            logger.error("ImportWorker failed: %s", e, exc_info=True)
            self.error.emit(str(e))


class BatchAnalysisWorker(QThread):
    """Runs Stockfish over every not yet analyzed game of the tracked player."""

    progress = pyqtSignal(int, int, int, int, str)  # game_no, games, move_no, moves, label
    finished = pyqtSignal(int, int)  # analyzed, total
    error = pyqtSignal(str)

    def __init__(self, engine_path: str, usernames: list[str], time_per_move: float | None):
        super().__init__()
        self.engine_path = engine_path
        self.usernames = usernames
        self.time_per_move = time_per_move
        self._cancel = threading.Event()
        self._analyzer: Analyzer | None = None

    def cancel(self):
        self._cancel.set()
        if self._analyzer is not None:
            try:
                self._analyzer.cancel()
            except Exception as e:
                logger.debug("Batch cancel: %s", e)

    def run(self):
        analyzer: Analyzer | None = None
        try:
            history = GameHistoryManager()
            ids = pending_game_ids(history, self.usernames)
            if not ids:
                self.finished.emit(0, 0)
                return
            # A dedicated analyzer/engine keeps the batch independent of the
            # single-game analysis on the Analyse page.
            analyzer = Analyzer(EngineManager(self.engine_path))
            self._analyzer = analyzer
            if self.time_per_move is not None:
                analyzer.config["time_per_move"] = self.time_per_move
            done = analyze_games(
                analyzer,
                history,
                ids,
                progress=lambda *a: self.progress.emit(*a),
                cancel=self._cancel,
            )
            self.finished.emit(done, len(ids))
        except Exception as e:
            logger.error("BatchAnalysisWorker failed: %s", e, exc_info=True)
            self.error.emit(str(e))
        finally:
            self._analyzer = None
            if analyzer is not None:
                analyzer.close()
