"""
Profile page ("Mein Profil"): imports and batch-analyzes all games of the
player, then shows skills, strengths/weaknesses, style, patterns, openings,
trends and a personal training plan.
"""

from __future__ import annotations

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from src.backend.analysis.profile import (
    GameRef,
    Insight,
    OpeningLine,
    Pattern,
    PlayerProfile,
    SkillScore,
    StyleProfile,
    TrainingItem,
)
from src.gui.components.toast import Toast
from src.gui.styles import Styles
from src.gui.utils.gui_utils import clear_layout, create_button, create_combobox
from src.gui.views.metrics.base_card import MetricCard
from src.utils.logger import logger
from src.utils.translations import tr_color, tr_filter

from . import charts
from .import_dialog import ProfileImportDialog
from .puzzle_trainer import PuzzleTrainerDialog
from .workers import BATCH_SPEEDS, BatchAnalysisWorker, ImportWorker, ProfileWorker

FORMAT_FILTERS = ["All Formats", "Bullet", "Blitz", "Rapid", "Classical", "Daily"]
PERIOD_FILTERS = ["All Time", "Last 30 Days", "Last 90 Days", "This Year"]

_SEVERITY_LABEL = {
    "hoch": "Hohe Priorität",
    "mittel": "Mittel",
    "niedrig": "Gering",
    "positiv": "Stärke",
}


def _label(
    text: str, size: int = 13, color: str | None = None, bold: bool = False, wrap=True
) -> QLabel:
    lbl = QLabel(text)
    lbl.setWordWrap(wrap)
    lbl.setTextFormat(Qt.TextFormat.PlainText)
    lbl.setStyleSheet(
        Styles.get_label_style(size=size, color=color or Styles.COLOR_TEXT_PRIMARY, bold=bold)
        + " background: transparent; border: none;"
    )
    return lbl


def _score_color(score: float) -> str:
    if score >= 65:
        return Styles.COLOR_RESULT_WIN
    if score >= 45:
        return Styles.COLOR_INACCURACY
    return Styles.COLOR_BLUNDER


class ProfileView(QWidget):
    game_requested = pyqtSignal(str, int)  # game_id, ply_index
    request_settings = pyqtSignal()
    history_changed = pyqtSignal()

    def __init__(self, config_manager, engine_path_provider=None):
        super().__init__()
        self.config_manager = config_manager
        self._engine_path_provider = engine_path_provider or (
            lambda: self.config_manager.get("engine_path", "stockfish")
        )
        self.profile: PlayerProfile | None = None
        self.profile_worker: ProfileWorker | None = None
        self.import_worker: ImportWorker | None = None
        self.batch_worker: BatchAnalysisWorker | None = None
        self._needs_refresh = True
        self._setup_ui()

    # ------------------------------------------------------------------ setup
    @property
    def needs_refresh(self) -> bool:
        return self._needs_refresh

    def mark_dirty(self) -> None:
        self._needs_refresh = True

    def usernames(self) -> list[str]:
        names = [
            self.config_manager.get("chesscom_username", ""),
            self.config_manager.get("lichess_username", ""),
        ]
        return [n for n in names if n]

    def _setup_ui(self):
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        self.header_bar = QFrame()
        self.header_bar.setStyleSheet(Styles.get_header_bar_ext_style(Styles.COLOR_BACKGROUND))
        header = QHBoxLayout(self.header_bar)
        header.setContentsMargins(24, 12, 24, 12)
        self.title_lbl = _label("Mein Schachprofil", size=24, bold=True, wrap=False)
        header.addWidget(self.title_lbl)
        header.addStretch()

        self.format_combo = create_combobox(items=[])
        for v in FORMAT_FILTERS:
            self.format_combo.addItem(tr_filter(v), v)
        self.period_combo = create_combobox(items=[])
        for v in PERIOD_FILTERS:
            self.period_combo.addItem(tr_filter(v), v)
        self.format_combo.currentIndexChanged.connect(lambda _: self.refresh(force=True))
        self.period_combo.currentIndexChanged.connect(lambda _: self.refresh(force=True))
        header.addWidget(self.format_combo)
        header.addWidget(self.period_combo)

        self.btn_import = create_button(
            "Partien importieren",
            style="secondary",
            on_click=self.open_import,
            icon_name="fa5s.download",
        )
        self.speed_combo = create_combobox(list(BATCH_SPEEDS), current="Schnell (0,1 s/Zug)")
        self.speed_combo.setToolTip("Engine-Zeit pro Zug für die Stapelanalyse")
        self.btn_batch = create_button(
            "Alle analysieren", on_click=self.toggle_batch, icon_name="fa5s.bolt"
        )
        self.btn_refresh = create_button(
            "Aktualisieren",
            style="secondary",
            on_click=lambda: self.refresh(force=True),
            icon_name="fa5s.sync-alt",
        )
        for w in (self.btn_import, self.speed_combo, self.btn_batch, self.btn_refresh):
            header.addWidget(w)
        root.addWidget(self.header_bar)

        # Progress panel for import / batch analysis
        self.progress_panel = QFrame()
        self.progress_panel.setStyleSheet(
            f"background-color: {Styles.COLOR_SURFACE}; border-bottom: 1px solid {Styles.COLOR_BORDER};"
        )
        pp = QHBoxLayout(self.progress_panel)
        pp.setContentsMargins(24, 8, 24, 8)
        self.progress_lbl = _label("", size=12, wrap=False)
        self.progress_bar = QProgressBar()
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(8)
        self.btn_cancel = create_button("Abbrechen", style="secondary", on_click=self.cancel_jobs)
        pp.addWidget(self.progress_lbl, 2)
        pp.addWidget(self.progress_bar, 3)
        pp.addWidget(self.btn_cancel)
        self.progress_panel.hide()
        root.addWidget(self.progress_panel)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setStyleSheet(f"background-color: {Styles.COLOR_BACKGROUND}; border: none;")
        container = QWidget()
        self.content_layout = QVBoxLayout(container)
        self.content_layout.setContentsMargins(24, 20, 24, 24)
        self.content_layout.setSpacing(18)
        self.scroll.setWidget(container)
        root.addWidget(self.scroll, 1)

    # ------------------------------------------------------------------ data
    def refresh(self, force: bool = False):
        if not force and not self._needs_refresh and self.profile is not None:
            return
        names = self.usernames()
        if not names:
            self._show_message(
                "Wer bist du?",
                "Trage in den Einstellungen deinen chess.com- (oder Lichess-)Benutzernamen ein. "
                "Dann erkennt das Programm, welche Seite du in jeder Partie gespielt hast, und "
                "baut daraus dein persönliches Profil.",
                ("Zu den Einstellungen", self.request_settings.emit),
            )
            return
        if self.profile_worker is not None and self.profile_worker.isRunning():
            return
        self._needs_refresh = False
        self._show_message("Profil wird berechnet …", "Deine Partien werden ausgewertet.")
        self.profile_worker = ProfileWorker(
            names, self.format_combo.currentData(), self.period_combo.currentData()
        )
        self.profile_worker.finished.connect(self._on_profile)
        self.profile_worker.error.connect(
            lambda e: self._show_message("Fehler beim Berechnen des Profils", e)
        )
        self.profile_worker.start()

    def _on_profile(self, profile: PlayerProfile):
        self.profile = profile
        self.render()

    def refresh_styles(self):
        self.header_bar.setStyleSheet(Styles.get_header_bar_ext_style(Styles.COLOR_BACKGROUND))
        self.scroll.setStyleSheet(f"background-color: {Styles.COLOR_BACKGROUND}; border: none;")
        if self.profile is not None:
            self.render()

    # ------------------------------------------------------------------ rendering
    def _show_message(self, title: str, text: str, action: tuple | None = None):
        clear_layout(self.content_layout)
        card = MetricCard(title)
        body = _label(text, size=14, color=Styles.COLOR_TEXT_SECONDARY)
        card.card_layout.addWidget(body)
        if action:
            card.card_layout.addWidget(
                create_button(action[0], on_click=action[1]), 0, Qt.AlignmentFlag.AlignLeft
            )
        self.content_layout.addWidget(card)
        self.content_layout.addStretch()

    def render(self):
        p = self.profile
        if p is None:
            return
        clear_layout(self.content_layout)
        names = ", ".join(p.usernames)
        if p.total_games == 0:
            self._show_message(
                "Noch keine Partien",
                f"Für {names} sind noch keine Partien gespeichert. Importiere deine Partien von "
                "chess.com oder aus PGN-Dateien, um dein Profil aufzubauen.",
                ("Partien importieren", self.open_import),
            )
            return

        self.content_layout.addLayout(self._kpi_row(p))
        if p.is_empty:
            self._show_message_inline(
                "Partien analysieren",
                f"{p.total_games} Partien gefunden, aber noch keine analysiert. Starte die "
                "Stapelanalyse mit „Alle analysieren“ – danach siehst du hier Stärken, Schwächen, "
                "Spielstil und deinen Trainingsplan.",
            )
            self.content_layout.addStretch()
            return
        if p.analyzed_games < 10:
            self._show_message_inline(
                "Wenig Daten",
                f"Erst {p.analyzed_games} Partien analysiert. Ab etwa 20–30 analysierten Partien "
                "werden die Aussagen deutlich verlässlicher.",
            )

        grid = QGridLayout()
        grid.setHorizontalSpacing(18)
        grid.setVerticalSpacing(18)
        grid.addWidget(self._skills_card(p.skills), 0, 0, 1, 2)
        grid.addWidget(self._insight_card("Stärken", p.strengths, Styles.COLOR_RESULT_WIN), 1, 0)
        grid.addWidget(self._insight_card("Schwächen", p.weaknesses, Styles.COLOR_BLUNDER), 1, 1)
        if p.style:
            grid.addWidget(self._style_card(p.style), 2, 0)
        grid.addWidget(self._patterns_card(p.patterns), 2, 1)
        grid.addWidget(self._training_card(p.training_plan, len(p.puzzles)), 3, 0)
        grid.addWidget(self._openings_card(p.openings_best, p.openings_worst), 3, 1)
        grid.addWidget(self._trend_card(p), 4, 0)
        grid.addWidget(self._breakdown_card(p.breakdowns), 4, 1)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        self.content_layout.addLayout(grid)
        self.content_layout.addStretch()

    def _show_message_inline(self, title: str, text: str):
        card = MetricCard(title)
        card.card_layout.addWidget(_label(text, size=13, color=Styles.COLOR_TEXT_SECONDARY))
        self.content_layout.addWidget(card)

    def _kpi_row(self, p: PlayerProfile) -> QHBoxLayout:
        o = p.overview
        row = QHBoxLayout()
        row.setSpacing(14)
        ratings = " · ".join(f"{k} {v}" for k, v in o.get("ratings", {}).items()) or "–"
        form = o.get("form_delta")
        form_txt = "–" if form is None else f"{form:+.1f} %"
        tiles = [
            ("Partien", f"{p.total_games}", f"{p.analyzed_games} analysiert"),
            (
                "Bilanz",
                f"{o.get('wins', 0)} / {o.get('draws', 0)} / {o.get('losses', 0)}",
                f"{o.get('score_pct', 0):.0f} % der Punkte",
            ),
            (
                "Ø Genauigkeit",
                f"{o.get('avg_accuracy', 0):.1f} %",
                f"{o.get('clean_games_pct', 0):.0f} % ohne Patzer",
            ),
            ("Wertung", ratings, f"Bester Sieg gegen {o.get('best_win', '–')}"),
            ("Form", form_txt, "letzte 20 vs. 20 davor"),
        ]
        for title, value, sub in tiles:
            card = MetricCard(None)
            card.card_layout.setSpacing(4)
            card.card_layout.addWidget(_label(title, size=12, color=Styles.COLOR_TEXT_SECONDARY))
            card.card_layout.addWidget(_label(value, size=20, bold=True))
            card.card_layout.addWidget(_label(sub, size=11, color=Styles.COLOR_TEXT_MUTED))
            row.addWidget(card, 1)
        return row

    def _skills_card(self, skills: list[SkillScore]) -> MetricCard:
        card = MetricCard("Fähigkeiten")
        body = QHBoxLayout()
        body.addWidget(charts.skill_radar(skills), 2)
        bars = QVBoxLayout()
        bars.setSpacing(10)
        for s in sorted(skills, key=lambda x: x.score, reverse=True):
            head = QHBoxLayout()
            name = s.name + ("" if s.reliable else "  (wenig Daten)")
            head.addWidget(_label(name, size=13, bold=True, wrap=False))
            head.addStretch()
            head.addWidget(
                _label(
                    f"{s.score:.0f} · {s.grade}", size=12, color=_score_color(s.score), wrap=False
                )
            )
            bars.addLayout(head)
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(int(round(s.score)))
            bar.setTextVisible(False)
            bar.setFixedHeight(6)
            bar.setStyleSheet(
                f"QProgressBar {{ background: {Styles.COLOR_SURFACE_LIGHT}; border: none; border-radius: 3px; }}"
                f"QProgressBar::chunk {{ background: {_score_color(s.score)}; border-radius: 3px; }}"
            )
            bars.addWidget(bar)
            bars.addWidget(_label(s.detail, size=11, color=Styles.COLOR_TEXT_MUTED))
        body.addLayout(bars, 3)
        card.card_layout.addLayout(body)
        return card

    def _insight_card(self, title: str, items: list[Insight], color: str) -> MetricCard:
        card = MetricCard(title)
        if not items:
            card.card_layout.addWidget(
                _label("Noch keine eindeutigen Auffälligkeiten.", color=Styles.COLOR_TEXT_MUTED)
            )
        for ins in items:
            box = QFrame()
            box.setStyleSheet(
                f"QFrame {{ border-left: 3px solid {color}; background: {Styles.COLOR_SURFACE_LIGHT};"
                " border-radius: 6px; }"
            )
            bl = QVBoxLayout(box)
            bl.setContentsMargins(12, 8, 12, 8)
            bl.addWidget(_label(f"{ins.title}  ·  {ins.category}", size=13, bold=True))
            bl.addWidget(_label(ins.text, size=12, color=Styles.COLOR_TEXT_SECONDARY))
            card.card_layout.addWidget(box)
        card.card_layout.addStretch()
        return card

    def _style_card(self, style: StyleProfile) -> MetricCard:
        card = MetricCard("Spielstil")
        card.card_layout.addWidget(
            _label(style.label, size=20, bold=True, color=Styles.COLOR_ACCENT)
        )
        card.card_layout.addWidget(
            _label(style.description, size=12, color=Styles.COLOR_TEXT_SECONDARY)
        )
        for axis in style.axes:
            row = QHBoxLayout()
            row.addWidget(
                _label(axis.low_label, size=11, color=Styles.COLOR_TEXT_MUTED, wrap=False)
            )
            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(int(round(axis.value)))
            bar.setTextVisible(False)
            bar.setFixedHeight(6)
            bar.setToolTip(f"{axis.name}: {axis.value:.0f}/100")
            row.addWidget(bar, 1)
            row.addWidget(
                _label(axis.high_label, size=11, color=Styles.COLOR_TEXT_MUTED, wrap=False)
            )
            card.card_layout.addWidget(_label(axis.name, size=12, bold=True))
            card.card_layout.addLayout(row)
        if style.facts:
            card.card_layout.addWidget(
                _label("• " + "\n• ".join(style.facts), size=12, color=Styles.COLOR_TEXT_SECONDARY)
            )
        card.card_layout.addStretch()
        return card

    def _ref_button(self, ref: GameRef) -> QPushButton:
        btn = QPushButton(ref.label)
        btn.setToolTip(ref.detail)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setStyleSheet(Styles.get_card_action_button_style())
        btn.clicked.connect(lambda _=False, r=ref: self.game_requested.emit(r.game_id, r.ply_index))
        return btn

    def _examples_row(self, refs: list[GameRef]) -> QWidget:
        w = QWidget()
        lay = QHBoxLayout(w)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)
        for ref in refs[:3]:
            lay.addWidget(self._ref_button(ref))
        lay.addStretch()
        return w

    def _patterns_card(self, patterns: list[Pattern]) -> MetricCard:
        card = MetricCard("Wiederkehrende Muster")
        if not patterns:
            card.card_layout.addWidget(
                _label(
                    "Noch keine klaren Muster erkannt – mit mehr analysierten Partien wird das Bild deutlicher.",
                    color=Styles.COLOR_TEXT_MUTED,
                )
            )
        colors = {
            "hoch": Styles.COLOR_BLUNDER,
            "mittel": Styles.COLOR_INACCURACY,
            "niedrig": Styles.COLOR_TEXT_MUTED,
            "positiv": Styles.COLOR_RESULT_WIN,
        }
        for pat in patterns[:7]:
            head = QHBoxLayout()
            head.addWidget(_label(pat.title, size=13, bold=True))
            head.addStretch()
            head.addWidget(
                _label(
                    _SEVERITY_LABEL.get(pat.severity, ""),
                    size=11,
                    color=colors.get(pat.severity),
                    wrap=False,
                )
            )
            card.card_layout.addLayout(head)
            card.card_layout.addWidget(_label(pat.text, size=12, color=Styles.COLOR_TEXT_SECONDARY))
            if pat.examples:
                card.card_layout.addWidget(self._examples_row(pat.examples))
        card.card_layout.addStretch()
        return card

    def _training_card(self, items: list[TrainingItem], puzzle_count: int) -> MetricCard:
        btn = create_button(
            f"Eigene Fehler trainieren ({puzzle_count})",
            on_click=self.open_puzzles,
            icon_name="fa5s.puzzle-piece",
        )
        btn.setEnabled(puzzle_count > 0)
        card = MetricCard("Dein Trainingsplan", action_widget=btn)
        if not items:
            card.card_layout.addWidget(
                _label(
                    "Aktuell keine dringenden Baustellen – weiter so!",
                    color=Styles.COLOR_TEXT_MUTED,
                )
            )
        for item in items:
            card.card_layout.addWidget(_label(f"{item.priority}. {item.title}", size=14, bold=True))
            card.card_layout.addWidget(_label(item.reason, size=12, color=Styles.COLOR_TEXT_MUTED))
            card.card_layout.addWidget(
                _label("• " + "\n• ".join(item.steps), size=12, color=Styles.COLOR_TEXT_SECONDARY)
            )
            if item.examples:
                card.card_layout.addWidget(self._examples_row(item.examples))
        card.card_layout.addStretch()
        return card

    def _opening_rows(self, layout: QVBoxLayout, title: str, lines: list[OpeningLine], color: str):
        layout.addWidget(_label(title, size=13, bold=True, color=color))
        if not lines:
            layout.addWidget(
                _label(
                    "Noch zu wenige Partien je Eröffnung.", size=12, color=Styles.COLOR_TEXT_MUTED
                )
            )
        for o in lines:
            extra = f", 1. Fehler Ø Zug {o.first_error_move:.0f}" if o.first_error_move else ""
            layout.addWidget(
                _label(
                    f"{o.name} ({tr_color(o.color)}) – {o.games} Partien, {o.score_pct:.0f} % Punkte, "
                    f"Ø {o.avg_accuracy:.1f} %{extra}",
                    size=12,
                    color=Styles.COLOR_TEXT_SECONDARY,
                )
            )

    def _openings_card(self, best: list[OpeningLine], worst: list[OpeningLine]) -> MetricCard:
        card = MetricCard("Eröffnungen")
        self._opening_rows(
            card.card_layout, "Deine besten Eröffnungen", best, Styles.COLOR_RESULT_WIN
        )
        self._opening_rows(
            card.card_layout, "Deine Problemeröffnungen", worst, Styles.COLOR_BLUNDER
        )
        card.card_layout.addStretch()
        return card

    def _trend_card(self, p: PlayerProfile) -> MetricCard:
        card = MetricCard("Entwicklung")
        monthly = p.trends.get("monthly", [])
        if len(monthly) >= 2:
            card.card_layout.addWidget(
                _label("Genauigkeit und Punkte-Quote pro Monat", size=12, bold=True)
            )
            card.card_layout.addWidget(charts.monthly_trend(monthly))
        ratings = p.trends.get("ratings", {})
        if ratings:
            card.card_layout.addWidget(_label("Wertungsverlauf", size=12, bold=True))
            card.card_layout.addWidget(charts.rating_curve(ratings))
        if len(monthly) < 2 and not ratings:
            card.card_layout.addWidget(
                _label(
                    "Für Verlaufsdiagramme werden Partien aus mindestens zwei Monaten benötigt.",
                    color=Styles.COLOR_TEXT_MUTED,
                )
            )
        return card

    def _breakdown_card(self, breakdowns: dict) -> MetricCard:
        card = MetricCard("Ergebnisse im Detail")
        sections = (
            ("Nach Farbe", "color"),
            ("Nach Bedenkzeit", "speed"),
            ("Nach Gegnerstärke", "opponent"),
        )
        for title, key in sections:
            rows = breakdowns.get(key, [])
            if not rows:
                continue
            card.card_layout.addWidget(_label(title, size=13, bold=True))
            grid = QGridLayout()
            grid.setHorizontalSpacing(14)
            for col, head in enumerate(("", "Partien", "S / R / N", "Punkte", "Ø Gen.")):
                grid.addWidget(
                    _label(head, size=11, color=Styles.COLOR_TEXT_MUTED, wrap=False), 0, col
                )
            for r, row in enumerate(rows, start=1):
                values = (
                    row["label"],
                    str(row["games"]),
                    f"{row['wins']} / {row['draws']} / {row['losses']}",
                    f"{row['score_pct']:.0f} %",
                    f"{row['avg_accuracy']:.1f} %" if row["avg_accuracy"] else "–",
                )
                for col, v in enumerate(values):
                    grid.addWidget(_label(v, size=12, wrap=False), r, col)
            card.card_layout.addLayout(grid)
        card.card_layout.addStretch()
        return card

    # ------------------------------------------------------------------ actions
    def open_puzzles(self):
        if not self.profile or not self.profile.puzzles:
            return
        dlg = PuzzleTrainerDialog(self.profile.puzzles, self)
        dlg.open_game.connect(self.game_requested.emit)
        dlg.exec()

    def _busy(self) -> bool:
        return any(w is not None and w.isRunning() for w in (self.import_worker, self.batch_worker))

    def open_import(self):
        if self._busy():
            return
        dlg = ProfileImportDialog(self.config_manager.get("chesscom_username", ""), self)
        if not dlg.exec():
            return
        if dlg.username and not self.config_manager.get("chesscom_username", ""):
            self.config_manager.set("chesscom_username", dlg.username)
        self.import_worker = ImportWorker(
            username=dlg.username, months=dlg.months, pgn_text=dlg.pgn_text
        )
        self.import_worker.progress.connect(self._on_import_progress)
        self.import_worker.finished.connect(self._on_import_done)
        self.import_worker.error.connect(self._on_job_error)
        self._set_busy(True, "Import läuft …")
        self.import_worker.start()

    def _on_import_progress(self, i: int, n: int, label: str):
        self.progress_bar.setRange(0, max(1, n))
        self.progress_bar.setValue(i)
        self.progress_lbl.setText(label)

    def _on_import_done(self, result):
        self._set_busy(False)
        Toast.show_message(
            self.window(),
            f"{result.imported} neue Partien importiert ({result.already_known} bereits vorhanden).",
            "success",
        )
        self.history_changed.emit()
        self.refresh(force=True)

    def toggle_batch(self):
        if self.batch_worker is not None and self.batch_worker.isRunning():
            self.cancel_jobs()
            return
        if self._busy():
            return
        names = self.usernames()
        if not names:
            self.request_settings.emit()
            return
        speed = BATCH_SPEEDS.get(self.speed_combo.currentText())
        self.batch_worker = BatchAnalysisWorker(self._engine_path_provider(), names, speed)
        self.batch_worker.progress.connect(self._on_batch_progress)
        self.batch_worker.finished.connect(self._on_batch_done)
        self.batch_worker.error.connect(self._on_job_error)
        self._set_busy(True, "Stapelanalyse wird vorbereitet …")
        self.btn_batch.setText("  Analyse stoppen")
        self.batch_worker.start()

    def _on_batch_progress(self, game_no: int, games: int, move_no: int, moves: int, label: str):
        total = max(1, games * 100)
        frac = move_no / moves if moves else 0
        self.progress_bar.setRange(0, total)
        self.progress_bar.setValue(int(((game_no - 1) + frac) * 100))
        self.progress_lbl.setText(f"Partie {game_no} von {games}: {label} (Zug {move_no}/{moves})")

    def _on_batch_done(self, done: int, total: int):
        self._set_busy(False)
        self.btn_batch.setText("  Alle analysieren")
        if total == 0:
            Toast.show_message(self.window(), "Alle Partien sind bereits analysiert.", "info")
        else:
            Toast.show_message(self.window(), f"{done} von {total} Partien analysiert.", "success")
        self.history_changed.emit()
        self.refresh(force=True)

    def _on_job_error(self, msg: str):
        logger.error("Profile job failed: %s", msg)
        self._set_busy(False)
        self.btn_batch.setText("  Alle analysieren")
        Toast.show_message(self.window(), f"Fehler: {msg}", "error")

    def cancel_jobs(self):
        for w in (self.import_worker, self.batch_worker):
            if w is not None and w.isRunning():
                w.cancel()
        self.progress_lbl.setText("Wird gestoppt …")

    def _set_busy(self, busy: bool, text: str = ""):
        self.progress_panel.setVisible(busy)
        self.progress_lbl.setText(text)
        self.progress_bar.setRange(0, 0 if busy else 1)
        self.btn_import.setEnabled(not busy)
        self.btn_refresh.setEnabled(not busy)

    def shutdown(self):
        """Stop background work on application exit."""
        self.cancel_jobs()
        for w in (self.import_worker, self.batch_worker, self.profile_worker):
            if w is not None and w.isRunning():
                w.wait(5000)
