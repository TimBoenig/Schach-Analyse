"""
Bulk game import and batch analysis for building a player profile.

- import_pgn_text: store every game of a (multi-game) PGN in the history.
- import_chesscom_games: fetch a user's chess.com archives (public API) and store them.
- pending_game_ids / analyze_games: run Stockfish over all not yet analyzed games.

Zero Qt: GUI workers wrap these functions and forward progress via signals.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from src.backend.api.chess_com_api import ChessComAPI
from src.backend.storage.pgn_parser import PGNParser
from src.utils.logger import logger

ProgressFn = Callable[[int, int, str], None]


@dataclass
class ImportResult:
    found: int = 0
    imported: int = 0
    already_known: int = 0


def import_pgn_text(history_manager: Any, text: str, source: str | None = None) -> ImportResult:
    """Parse a PGN (one or many games) and store all new games in the history."""
    games = PGNParser.parse_pgn_text(text or "")
    result = ImportResult(found=len(games))
    if not games:
        return result
    known = history_manager.get_all_game_ids()
    new_items = []
    for g in games:
        if g.game_id in known:
            result.already_known += 1
            continue
        if source:
            g.metadata.source = source
        new_items.append((g, g.pgn_content or ""))
        known.add(g.game_id)
    if new_items:
        result.imported = history_manager.save_games_bulk(new_items)
    return result


def import_chesscom_games(
    history_manager: Any,
    username: str,
    months: int | None = 6,
    progress: ProgressFn | None = None,
    cancel: threading.Event | None = None,
) -> ImportResult:
    """
    Import a chess.com player's games from the last `months` monthly archives
    (all archives when months is None). Newest months are fetched first so a
    cancelled import still contains the most relevant games.
    """
    archives = ChessComAPI.get_archive_urls(username)
    if months is not None and months > 0:
        archives = archives[-months:]
    archives = list(reversed(archives))
    total = ImportResult()
    for i, url in enumerate(archives, start=1):
        if cancel is not None and cancel.is_set():
            break
        month = "/".join(url.rstrip("/").split("/")[-2:])
        if progress:
            progress(i, len(archives), f"Lade Partien {month} …")
        games = ChessComAPI.get_archive_games(url)
        # Variants like bughouse or crazyhouse cannot be analyzed by Stockfish.
        playable = [g["pgn"] for g in games if g.get("rules", "chess") in ("chess", "chess960")]
        pgn_text = "\n\n".join(playable)
        part = import_pgn_text(history_manager, pgn_text, source="chesscom")
        total.found += part.found
        total.imported += part.imported
        total.already_known += part.already_known
    logger.info(
        "chess.com import for %s: %d found, %d new, %d known",
        username,
        total.found,
        total.imported,
        total.already_known,
    )
    return total


def _is_pending(row: dict[str, Any]) -> bool:
    raw = row.get("summary_json")
    if not raw:
        return True
    try:
        summary = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return True
    return summary.get("analysis_status") != "completed"


def pending_game_ids(history_manager: Any, usernames: list[str]) -> list[str]:
    """IDs of the tracked player's games that are not fully analyzed yet (newest first)."""
    rows = (
        history_manager.get_games_for_users(usernames)
        if usernames
        else history_manager.get_game_summaries()
    )
    return [str(r["id"]) for r in rows if _is_pending(r)]


def analyze_games(
    analyzer: Any,
    history_manager: Any,
    game_ids: list[str],
    progress: Callable[[int, int, int, int, str], None] | None = None,
    cancel: threading.Event | None = None,
) -> int:
    """
    Analyze the given games one after another with the shared Analyzer.

    progress(game_no, game_total, move_no, move_total, label) is called for every
    analyzed move. Returns the number of games completed. The analyzer stops its
    engine itself after each game (finally block), so the engine never leaks.
    """
    done = 0
    cancel = cancel or threading.Event()
    for i, gid in enumerate(game_ids, start=1):
        if cancel.is_set():
            break
        game = history_manager.get_game_analysis(gid)
        if game is None:
            continue
        if not game.moves and game.pgn_content:
            parsed = PGNParser.parse_pgn_text(game.pgn_content)
            if not parsed:
                continue
            game.moves = parsed[0].moves
            game.metadata.chess960 = parsed[0].metadata.chess960
        label = f"{game.metadata.white} – {game.metadata.black}"

        def _cb(current: int, total: int, move_data: Any = None, _i: int = i, _label: str = label):
            if cancel.is_set():
                raise InterruptedError("Batch analysis cancelled")
            if progress:
                progress(_i, len(game_ids), current, total, _label)

        try:
            analyzer.analyze_game(game, callback=_cb, cancel_token=cancel, resume=True)
            done += 1
        except InterruptedError:
            break
        except Exception as exc:
            if cancel.is_set():
                break
            logger.error("Batch analysis failed for game %s: %s", gid, exc)
    return done
