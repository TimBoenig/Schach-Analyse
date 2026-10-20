"""
Puzzle trainer: replays positions from the player's own games where a clearly
better move existed and asks the player to find it.
"""

from __future__ import annotations

import random

import chess
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import QDialog, QHBoxLayout, QLabel, QVBoxLayout

from src.backend.analysis.profile import Puzzle
from src.gui.board.explorer_board_widget import ExplorerBoardWidget
from src.gui.styles import Styles
from src.gui.utils.gui_utils import create_button
from src.utils.translations import tr_classification, tr_phase


class PuzzleTrainerDialog(QDialog):
    open_game = pyqtSignal(str, int)  # game_id, ply_index

    def __init__(self, puzzles: list[Puzzle], parent=None):
        super().__init__(parent)
        self.setWindowTitle("Eigene Fehler trainieren")
        self.resize(760, 860)
        self.setStyleSheet(Styles.get_dialog_surface_style())
        self.puzzles = list(puzzles)
        random.shuffle(self.puzzles)
        self.index = 0
        self.solved = 0
        self.attempts = 0
        self._current: Puzzle | None = None

        layout = QVBoxLayout(self)
        self.lbl_title = QLabel()
        self.lbl_title.setStyleSheet(Styles.get_card_title_style())
        layout.addWidget(self.lbl_title)
        self.lbl_info = QLabel()
        self.lbl_info.setWordWrap(True)
        self.lbl_info.setStyleSheet(Styles.get_secondary_label_style())
        layout.addWidget(self.lbl_info)

        self.board = ExplorerBoardWidget()
        self.board.move_made.connect(self._on_move)
        # The eval bar would give the solution away.
        self.board.eval_bar.setVisible(False)
        layout.addWidget(self.board, 1)

        self.lbl_feedback = QLabel(" ")
        self.lbl_feedback.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_feedback.setStyleSheet(Styles.get_label_style(size=15, bold=True))
        layout.addWidget(self.lbl_feedback)

        row = QHBoxLayout()
        self.btn_solution = create_button(
            "Lösung zeigen", style="secondary", on_click=self._show_solution
        )
        self.btn_game = create_button(
            "In Partie öffnen", style="secondary", on_click=self._open_game
        )
        self.btn_next = create_button(
            "Nächste Stellung", on_click=self._next, icon_name="fa5s.forward"
        )
        row.addWidget(self.btn_solution)
        row.addWidget(self.btn_game)
        row.addStretch()
        self.lbl_score = QLabel()
        row.addWidget(self.lbl_score)
        row.addWidget(self.btn_next)
        layout.addLayout(row)

        self._load()

    def _load(self):
        if not self.puzzles:
            self.lbl_title.setText("Keine Trainingsstellungen")
            self.lbl_info.setText(
                "Analysiere mehr Partien – Stellungen mit schweren Fehlern erscheinen hier automatisch."
            )
            for b in (self.btn_solution, self.btn_game, self.btn_next):
                b.setEnabled(False)
            return
        p = self.puzzles[self.index % len(self.puzzles)]
        self._current = p
        self.attempts = 0
        self.board.load_fen(p.fen, chess960=p.chess960)
        white_to_move = chess.Board(p.fen, chess960=p.chess960).turn == chess.WHITE
        if self.board.is_flipped == white_to_move:
            self.board.flip_board()
        side = "Weiß" if white_to_move else "Schwarz"
        self.lbl_title.setText(
            f"Stellung {self.index % len(self.puzzles) + 1} von {len(self.puzzles)} – {side} am Zug"
        )
        self.lbl_info.setText(
            f"Aus deiner Partie gegen {p.opponent or '?'} ({p.date}), {tr_phase(p.phase)}. "
            f"Du hast hier {p.played_san} gespielt ({tr_classification(p.classification)}, "
            f"−{p.wp_loss * 100:.0f} % Gewinnchance). Finde den besseren Zug!"
        )
        self.lbl_feedback.setText(" ")
        self._update_score()

    def _update_score(self):
        self.lbl_score.setText(f"Gelöst: {self.solved}")

    def _on_move(self, _fen: str):
        p = self._current
        if p is None or not self.board.board.move_stack:
            return
        played = self.board.board.move_stack[-1].uci()
        if played == p.best_move_uci:
            if self.attempts == 0:
                self.solved += 1
            self.lbl_feedback.setText(f"Richtig! {p.best_move_san} ist der beste Zug.")
            self.lbl_feedback.setStyleSheet(
                Styles.get_label_style(size=15, bold=True, color=Styles.COLOR_RESULT_WIN)
            )
            self._update_score()
        else:
            self.attempts += 1
            self.board.undo_move()
            self.lbl_feedback.setText("Nicht ganz – versuch es noch einmal.")
            self.lbl_feedback.setStyleSheet(
                Styles.get_label_style(size=15, bold=True, color=Styles.COLOR_MISTAKE)
            )

    def _show_solution(self):
        p = self._current
        if p is None:
            return
        self.attempts += 1
        self.board.set_best_move(p.best_move_uci)
        self.lbl_feedback.setText(f"Lösung: {p.best_move_san}")
        self.lbl_feedback.setStyleSheet(Styles.get_label_style(size=15, bold=True))

    def _next(self):
        self.index += 1
        self._load()

    def _open_game(self):
        if self._current is not None:
            self.open_game.emit(self._current.game_id, self._current.ply_index)
            self.accept()
