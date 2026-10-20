"""
Tests for bulk import (PGN / chess.com archives) and batch analysis orchestration.
"""

import json
import threading
from unittest.mock import MagicMock

from src.backend.services import game_import_service as svc
from src.backend.storage.game_history import GameHistoryManager

TWO_GAMES = """[White "Tim"]
[Black "A"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[White "B"]
[Black "Tim"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
"""


def test_import_pgn_text_stores_all_games_once(temp_db):
    history = GameHistoryManager(temp_db)
    first = svc.import_pgn_text(history, TWO_GAMES)
    again = svc.import_pgn_text(history, TWO_GAMES)

    assert (first.found, first.imported, first.already_known) == (2, 2, 0)
    # Deterministic MD5 ids make the second import a no-op.
    assert (again.imported, again.already_known) == (0, 2)
    assert len(history.get_all_game_ids()) == 2
    assert len(svc.pending_game_ids(history, ["tim"])) == 2


def test_import_chesscom_fetches_newest_months_and_skips_variants(temp_db, mocker):
    history = GameHistoryManager(temp_db)
    archives = [f"https://api.chess.com/pub/player/tim/games/2026/{m:02d}" for m in (1, 2, 3)]
    mocker.patch.object(svc.ChessComAPI, "get_archive_urls", return_value=archives)
    fetched: list[str] = []

    def fake_archive(url):
        fetched.append(url)
        games = TWO_GAMES.strip().split("\n\n[White")
        pgns = [games[0], "[White" + games[1]]
        return [{"pgn": pgns[0], "rules": "chess"}, {"pgn": pgns[1], "rules": "crazyhouse"}]

    mocker.patch.object(svc.ChessComAPI, "get_archive_games", side_effect=fake_archive)
    progress = MagicMock()

    result = svc.import_chesscom_games(history, "tim", months=2, progress=progress)

    assert fetched == archives[:0:-1]  # last two months, newest first
    assert result.imported == 1  # same chess game each month, crazyhouse skipped
    assert result.already_known == 1
    assert progress.call_count == 2
    stored = history.get_game(next(iter(history.get_all_game_ids())))
    assert stored["source"] == "chesscom"


def test_analyze_games_runs_pending_and_honours_cancel(temp_db):
    history = GameHistoryManager(temp_db)
    svc.import_pgn_text(history, TWO_GAMES)
    ids = svc.pending_game_ids(history, ["tim"])
    cancel = threading.Event()
    analyzed: list[str] = []

    analyzer = MagicMock()

    def fake_analyze(game, callback, cancel_token, resume):
        analyzed.append(game.game_id)
        assert game.moves, "moves must be parsed from the stored PGN"
        callback(1, len(game.moves))
        cancel.set()  # user presses stop during the first game

    analyzer.analyze_game.side_effect = fake_analyze
    progress = MagicMock()
    done = svc.analyze_games(analyzer, history, ids, progress=progress, cancel=cancel)

    assert done == 1 and analyzed == ids[:1]
    progress.assert_called_once()


def test_pending_ignores_completed_games(temp_db):
    history = GameHistoryManager(temp_db)
    svc.import_pgn_text(history, TWO_GAMES)
    gid = sorted(history.get_all_game_ids())[0]
    row = history.get_game(gid)
    row["summary_json"] = json.dumps({"analysis_status": "completed"})
    history.save_games_bulk([row], force_overwrite=True)
    assert gid not in svc.pending_game_ids(history, ["tim"])
