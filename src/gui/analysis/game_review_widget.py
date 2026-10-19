"""
"Review" tab of the analysis panel: German post-game review with grade,
phase assessment, key moments (clickable), positives, negatives and lessons.
"""

from __future__ import annotations

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from src.backend.analysis.profile import GameReview, build_game_review
from src.gui.styles import Styles
from src.gui.utils.gui_utils import clear_layout
from src.utils.logger import logger
from src.utils.translations import tr_classification


def _label(text: str, size: int = 12, color: str | None = None, bold: bool = False) -> QLabel:
    lbl = QLabel(text)
    lbl.setWordWrap(True)
    lbl.setTextFormat(Qt.TextFormat.PlainText)
    lbl.setStyleSheet(
        Styles.get_label_style(size=size, color=color or Styles.COLOR_TEXT_PRIMARY, bold=bold)
        + " background: transparent; border: none;"
    )
    return lbl


_CLASS_COLORS = {
    "Brilliant": "COLOR_BRILLIANT",
    "Great": "COLOR_GREAT",
    "Best": "COLOR_BEST",
    "Excellent": "COLOR_EXCELLENT",
    "Good": "COLOR_GOOD",
    "Inaccuracy": "COLOR_INACCURACY",
    "Mistake": "COLOR_MISTAKE",
    "Blunder": "COLOR_BLUNDER",
    "Miss": "COLOR_MISS",
}


class _MomentCard(QFrame):
    """Clickable key-moment card (word-wrapping text, unlike QPushButton)."""

    clicked = pyqtSignal()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class GameReviewWidget(QWidget):
    move_clicked = pyqtSignal(int)

    def __init__(self, config_manager, parent=None):
        super().__init__(parent)
        self.config_manager = config_manager
        self.game = None
        self.review: GameReview | None = None
        self._color_override: str | None = None
        self._dirty = True

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        switch = QHBoxLayout()
        switch.setContentsMargins(4, 4, 4, 0)
        switch.addWidget(_label("Sicht von:", size=11, color=Styles.COLOR_TEXT_SECONDARY))
        self.btn_white = QPushButton("Weiß")
        self.btn_black = QPushButton("Schwarz")
        self._group = QButtonGroup(self)
        for i, b in enumerate((self.btn_white, self.btn_black)):
            b.setCheckable(True)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(Styles.get_toggle_button_style())
            self._group.addButton(b, i)
            switch.addWidget(b)
        switch.addStretch()
        self._group.idClicked.connect(self._on_color_clicked)
        outer.addLayout(switch)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setStyleSheet("background: transparent; border: none;")
        body = QWidget()
        self.body_layout = QVBoxLayout(body)
        self.body_layout.setContentsMargins(6, 6, 6, 6)
        self.body_layout.setSpacing(10)
        self.scroll.setWidget(body)
        outer.addWidget(self.scroll, 1)

    # ------------------------------------------------------------------ public
    def set_game(self, game) -> None:
        if game is not self.game:
            self._color_override = None
        self.game = game
        self._dirty = True
        if self.isVisible():
            self.rebuild()

    def showEvent(self, event):
        super().showEvent(event)
        if self._dirty:
            self.rebuild()

    def user_color(self) -> str:
        if self._color_override:
            return self._color_override
        if self.game is None:
            return "white"
        names = {
            n.lower()
            for n in (
                self.config_manager.get("chesscom_username", ""),
                self.config_manager.get("lichess_username", ""),
            )
            if n
        }
        if (self.game.metadata.black or "").lower() in names:
            return "black"
        return "white"

    def _on_color_clicked(self, idx: int):
        self._color_override = "white" if idx == 0 else "black"
        self.rebuild()

    def rebuild(self) -> None:
        self._dirty = False
        clear_layout(self.body_layout)
        color = self.user_color()
        self.btn_white.setChecked(color == "white")
        self.btn_black.setChecked(color == "black")
        if self.game is None:
            return
        try:
            self.review = build_game_review(self.game, color)
        except Exception as e:
            logger.error("Game review failed: %s", e, exc_info=True)
            self.review = None
        if self.review is None:
            self.body_layout.addWidget(
                _label(
                    "Analysiere die Partie zuerst – danach erscheint hier dein ausführliches Review: "
                    "was gut lief, was schlecht lief, die Schlüsselmomente und was du verbessern kannst.",
                    color=Styles.COLOR_TEXT_SECONDARY,
                )
            )
            self.body_layout.addStretch()
            return
        self._render(self.review)

    # ------------------------------------------------------------------ render
    def _section(self, title: str) -> None:
        self.body_layout.addWidget(_label(title, size=13, bold=True, color=Styles.COLOR_ACCENT))

    def _bullets(self, items: list[str], color: str) -> None:
        for text in items:
            row = QHBoxLayout()
            dot = _label("●", size=9, color=color)
            dot.setFixedWidth(12)
            dot.setAlignment(Qt.AlignmentFlag.AlignTop)
            row.addWidget(dot)
            row.addWidget(_label(text, color=Styles.COLOR_TEXT_SECONDARY), 1)
            self.body_layout.addLayout(row)

    def _render(self, r: GameReview) -> None:
        self.body_layout.addWidget(_label(r.result_text, size=15, bold=True))
        self.body_layout.addWidget(_label(r.headline, color=Styles.COLOR_TEXT_SECONDARY))
        self.body_layout.addWidget(
            _label(
                f"Deine Genauigkeit: {r.accuracy:.1f} %  ·  Gegner: {r.opponent_accuracy:.1f} %  ·  Note {r.grade}",
                size=12,
                bold=True,
            )
        )

        self._section("Phasen")
        for ph in r.phases:
            if ph.accuracy is None:
                text = f"{ph.name}: {ph.comment}"
            else:
                text = f"{ph.name}: {ph.accuracy:.0f} % · Note {ph.grade} – {ph.comment}"
            self.body_layout.addWidget(_label(text, color=Styles.COLOR_TEXT_SECONDARY))

        self._section("Was lief gut")
        self._bullets(r.positives, Styles.COLOR_RESULT_WIN)
        self._section("Was lief schlecht")
        self._bullets(r.negatives, Styles.COLOR_BLUNDER)
        self._section("Das solltest du verbessern")
        self._bullets(r.lessons, Styles.COLOR_ACCENT)

        if r.key_moments:
            self._section("Schlüsselmomente (zum Ansehen anklicken)")
            for km in r.key_moments:
                color = getattr(Styles, _CLASS_COLORS.get(km.classification, "COLOR_TEXT_PRIMARY"))
                card = _MomentCard()
                card.setObjectName("MomentCard")
                card.setCursor(Qt.CursorShape.PointingHandCursor)
                card.setStyleSheet(
                    f"QFrame#MomentCard {{ border-radius: 8px; border: 1px solid {Styles.COLOR_BORDER};"
                    f" border-left: 4px solid {color}; background: {Styles.COLOR_SURFACE_LIGHT}; }}"
                    f"QFrame#MomentCard:hover {{ border-color: {Styles.COLOR_ACCENT}; }}"
                )
                card.setToolTip(tr_classification(km.classification))
                cl = QVBoxLayout(card)
                cl.setContentsMargins(10, 6, 10, 6)
                cl.setSpacing(2)
                marker = (
                    "★ Wendepunkt · "
                    if r.turning_point and km.ply_index == r.turning_point.ply_index
                    else ""
                )
                cl.addWidget(_label(f"{marker}{km.title}", bold=True))
                cl.addWidget(_label(km.text, size=11, color=Styles.COLOR_TEXT_SECONDARY))
                card.clicked.connect(lambda i=km.ply_index: self.move_clicked.emit(i))
                self.body_layout.addWidget(card)

        counts = {k: v for k, v in r.move_counts.items() if v and k != "Book"}
        if counts:
            self._section("Deine Züge")
            order = list(_CLASS_COLORS)
            text = " · ".join(f"{tr_classification(k)} {counts[k]}" for k in order if k in counts)
            self.body_layout.addWidget(_label(text, color=Styles.COLOR_TEXT_SECONDARY))
        self.body_layout.addStretch()
