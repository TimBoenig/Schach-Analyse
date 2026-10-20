"""
Advantage Capitalization and Comeback Card.
Visualizes how effectively a player converts decisive leads (+3.0 pawns)
versus squandering them, and their fighting spirit / comeback rate when trailing (-3.0 pawns).
Clean, open design with zero cluttered box-in-a-box frames.
"""

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from src.gui.styles import Styles
from src.gui.views.metrics.base_card import MetricCard


class AdvantageConversionCard(MetricCard):
    """
    Card visualizing game conversion and resilience:
    1. Advantage Capitalization: Win conversion from winning positions (>= +3.0 pawns).
    2. Choke / Throw Tracking: Distinguishing between drawn leads and thrown losses.
    3. Comeback / Resilience: Frequency of rescuing wins or draws from losing positions (<= -3.0 pawns).
    """

    drill_down_requested = pyqtSignal(str, str)  # (category, subcategory)

    def __init__(self, parent=None):
        self.stats: dict = {}
        self.content_widget: QWidget | None = None

        self.action_badge = QLabel("Verwertungsanalyse")
        self.action_badge.setStyleSheet(f"""
            background-color: {Styles.COLOR_SURFACE_LIGHT};
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 11px;
            font-weight: 600;
            border: 1px solid {Styles.COLOR_BORDER};
            border-radius: 6px;
            padding: 3px 8px;
        """)

        super().__init__(
            "Vorteilsverwertung & Aufholjagd",
            parent=parent,
            min_height=280,
            action_widget=self.action_badge,
        )

    def set_stats(self, stats: dict):
        self.stats = stats or {}
        self._render_view()

    def _render_view(self):
        if self.content_widget:
            self.card_layout.removeWidget(self.content_widget)
            self.content_widget.deleteLater()
            self.content_widget = None

        adv = self.stats.get("advantage_stats", {})
        total_games = self.stats.get("total", 0)

        hwa = adv.get("had_winning_advantage", 0)
        converted = adv.get("converted_advantage", 0)
        thrown = adv.get("thrown_losses", 0)
        squandered = adv.get("squandered_draws", 0)
        conv_rate = adv.get("conversion_rate", 0.0)

        hlp = adv.get("had_losing_position", 0)
        comeback_total = adv.get("comeback_drawn_or_won", 0)
        comeback_wins = adv.get("comeback_wins", 0)
        comeback_draws = adv.get("comeback_draws", 0)
        lost_deficit = max(0, hlp - comeback_total)
        comeback_rate = adv.get("comeback_rate", 0.0)

        # Update action badge
        if hwa > 0:
            throw_text = f" • {thrown} verschenkt" if thrown > 0 else ""
            self.action_badge.setText(f"{conv_rate:.0f}% Verwertung{throw_text}")
        else:
            self.action_badge.setText("Verwertungsanalyse")

        self.content_widget = QWidget()
        self.content_widget.setStyleSheet("background: transparent;")
        main_vbox = QVBoxLayout(self.content_widget)
        main_vbox.setContentsMargins(4, 4, 4, 4)
        main_vbox.setSpacing(14)

        if total_games == 0:
            empty_lbl = QLabel("Keine Partien für die Vorteilsanalyse vorhanden.")
            empty_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty_lbl.setStyleSheet(f"""
                color: {Styles.COLOR_TEXT_SECONDARY};
                font-size: 12px;
                padding: 40px 10px;
                background: transparent;
            """)
            main_vbox.addWidget(empty_lbl)
            self.set_content(self.content_widget)
            return

        # ═══════════════════════════════════════════════════════════════
        #  1. TOP ROW: 2 CLEAN OPEN PANELS
        # ═══════════════════════════════════════════════════════════════
        hero_row = QHBoxLayout()
        hero_row.setSpacing(16)

        # Panel 1: Decisive Advantage
        adv_pillar = QFrame()
        adv_pillar.setObjectName("adv_pillar")
        adv_pillar.setStyleSheet(f"""
            QFrame#adv_pillar {{
                background-color: {Styles.COLOR_SURFACE_LIGHT};
                border: 1px solid {Styles.COLOR_BORDER};
                border-radius: 8px;
            }}
        """)
        adv_vbox = QVBoxLayout(adv_pillar)
        adv_vbox.setContentsMargins(14, 12, 14, 12)
        adv_vbox.setSpacing(8)

        adv_title = QLabel("KLARER VORTEIL (≥ +3,0 BAUERN)")
        adv_title.setStyleSheet(f"""
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.5px;
            background: transparent;
        """)
        adv_vbox.addWidget(adv_title)

        num_sub_layout = QHBoxLayout()
        num_sub_layout.setSpacing(10)
        num_sub_layout.setAlignment(Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignLeft)

        adv_num = QLabel(f"{conv_rate:.1f}%" if hwa > 0 else "–")
        adv_num.setStyleSheet(f"""
            color: {Styles.COLOR_RESULT_WIN};
            font-size: 28px;
            font-weight: 700;
            background: transparent;
        """)
        num_sub_layout.addWidget(adv_num)

        adv_sub = QLabel(f"{converted} von {hwa} gewonnen" if hwa > 0 else "Kein Vorteil ≥ +3,0")
        adv_sub.setStyleSheet(f"""
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 12px;
            margin-bottom: 4px;
            background: transparent;
        """)
        num_sub_layout.addWidget(adv_sub)
        num_sub_layout.addStretch()
        adv_vbox.addLayout(num_sub_layout)

        # Segmented conversion bar (clean 6px bar)
        if hwa > 0:
            bar_frame = QFrame()
            bar_frame.setFixedHeight(6)
            bar_layout = QHBoxLayout(bar_frame)
            bar_layout.setContentsMargins(0, 0, 0, 0)
            bar_layout.setSpacing(2)

            win_w = max(1, int(converted / hwa * 100))
            draw_w = max(1, int(squandered / hwa * 100)) if squandered > 0 else 0
            loss_w = max(1, int(thrown / hwa * 100)) if thrown > 0 else 0

            seg_win = QFrame()
            seg_win.setStyleSheet(
                f"background-color: {Styles.COLOR_RESULT_WIN}; border-radius: 3px;"
            )
            bar_layout.addWidget(seg_win, win_w)

            if draw_w > 0:
                seg_draw = QFrame()
                seg_draw.setStyleSheet(
                    f"background-color: {Styles.COLOR_RESULT_DRAW}; border-radius: 3px;"
                )
                bar_layout.addWidget(seg_draw, draw_w)

            if loss_w > 0:
                seg_loss = QFrame()
                seg_loss.setStyleSheet(
                    f"background-color: {Styles.COLOR_BLUNDER}; border-radius: 3px;"
                )
                bar_layout.addWidget(seg_loss, loss_w)

            adv_vbox.addWidget(bar_frame)
        else:
            bar_placeholder = QFrame()
            bar_placeholder.setFixedHeight(6)
            bar_placeholder.setStyleSheet(
                f"background-color: {Styles.COLOR_BORDER}; border-radius: 3px;"
            )
            adv_vbox.addWidget(bar_placeholder)

        # Clean typography stats (NO nested box clutter)
        stats_line = QHBoxLayout()
        stats_line.setContentsMargins(0, 4, 0, 0)
        stats_line.setSpacing(8)

        def add_stat_col(
            layout: QHBoxLayout,
            value: int,
            label: str,
            color_hex: str,
            subcategory: str | None = None,
        ):
            w = QWidget()
            if subcategory and value > 0:
                w.setCursor(Qt.CursorShape.PointingHandCursor)
                w.setToolTip(f"Klicken, um {value} Stellungen anzusehen ({label})")
                w.setStyleSheet(f"""
                    QWidget {{
                        background: transparent;
                        border-radius: 4px;
                    }}
                    QWidget:hover {{
                        background-color: {Styles.COLOR_SURFACE};
                    }}
                """)
                w.mousePressEvent = lambda e, sc=subcategory: self.drill_down_requested.emit(
                    "advantage", sc
                )
            else:
                w.setStyleSheet("background: transparent;")

            vl = QVBoxLayout(w)
            vl.setContentsMargins(4, 2, 4, 2)
            vl.setSpacing(1)
            vl.setAlignment(Qt.AlignmentFlag.AlignCenter)

            v_lbl = QLabel(str(value))
            v_lbl.setStyleSheet(
                f"color: {color_hex}; font-size: 16px; font-weight: 700; background: transparent;"
            )
            v_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            vl.addWidget(v_lbl)

            l_lbl = QLabel(label)
            l_lbl.setStyleSheet(
                f"color: {Styles.COLOR_TEXT_SECONDARY}; font-size: 10px; font-weight: 600; background: transparent;"
            )
            l_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            vl.addWidget(l_lbl)

            layout.addWidget(w)

        add_stat_col(stats_line, converted, "Siege", Styles.COLOR_RESULT_WIN)
        add_stat_col(
            stats_line,
            squandered,
            "Remis",
            Styles.COLOR_TEXT_PRIMARY,
            subcategory="squandered_draws",
        )
        add_stat_col(
            stats_line,
            thrown,
            "Verschenkt",
            Styles.COLOR_BLUNDER if thrown > 0 else Styles.COLOR_TEXT_SECONDARY,
            subcategory="thrown_losses",
        )
        adv_vbox.addLayout(stats_line)

        hero_row.addWidget(adv_pillar)

        # Panel 2: Decisive Deficit & Comeback
        comeback_pillar = QFrame()
        comeback_pillar.setObjectName("comeback_pillar")
        comeback_pillar.setStyleSheet(f"""
            QFrame#comeback_pillar {{
                background-color: {Styles.COLOR_SURFACE_LIGHT};
                border: 1px solid {Styles.COLOR_BORDER};
                border-radius: 8px;
            }}
        """)
        cb_vbox = QVBoxLayout(comeback_pillar)
        cb_vbox.setContentsMargins(14, 12, 14, 12)
        cb_vbox.setSpacing(8)

        cb_title = QLabel("KLARER NACHTEIL (≤ −3,0 BAUERN)")
        cb_title.setStyleSheet(f"""
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.5px;
            background: transparent;
        """)
        cb_vbox.addWidget(cb_title)

        cb_num_sub = QHBoxLayout()
        cb_num_sub.setSpacing(10)
        cb_num_sub.setAlignment(Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignLeft)

        cb_num = QLabel(f"{comeback_rate:.1f}%" if hlp > 0 else "–")
        cb_num.setStyleSheet(f"""
            color: {Styles.COLOR_ACCENT};
            font-size: 28px;
            font-weight: 700;
            background: transparent;
        """)
        cb_num_sub.addWidget(cb_num)

        cb_sub = QLabel(
            f"{comeback_total} von {hlp} gerettet" if hlp > 0 else "Kein Nachteil ≤ −3,0"
        )
        cb_sub.setStyleSheet(f"""
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 12px;
            margin-bottom: 4px;
            background: transparent;
        """)
        cb_num_sub.addWidget(cb_sub)
        cb_num_sub.addStretch()
        cb_vbox.addLayout(cb_num_sub)

        # Segmented comeback bar
        if hlp > 0:
            cb_bar_frame = QFrame()
            cb_bar_frame.setFixedHeight(6)
            cb_bar_layout = QHBoxLayout(cb_bar_frame)
            cb_bar_layout.setContentsMargins(0, 0, 0, 0)
            cb_bar_layout.setSpacing(2)

            res_w = max(1, int(comeback_total / hlp * 100)) if comeback_total > 0 else 0
            def_w = max(1, int(lost_deficit / hlp * 100)) if lost_deficit > 0 else 0

            if res_w > 0:
                seg_res = QFrame()
                seg_res.setStyleSheet(
                    f"background-color: {Styles.COLOR_ACCENT}; border-radius: 3px;"
                )
                cb_bar_layout.addWidget(seg_res, res_w)

            if def_w > 0:
                seg_def = QFrame()
                seg_def.setStyleSheet(
                    f"background-color: {Styles.COLOR_BORDER}; border-radius: 3px;"
                )
                cb_bar_layout.addWidget(seg_def, def_w)

            cb_vbox.addWidget(cb_bar_frame)
        else:
            cb_bar_placeholder = QFrame()
            cb_bar_placeholder.setFixedHeight(6)
            cb_bar_placeholder.setStyleSheet(
                f"background-color: {Styles.COLOR_BORDER}; border-radius: 3px;"
            )
            cb_vbox.addWidget(cb_bar_placeholder)

        # Clean typography stats for Comeback
        cb_stats_line = QHBoxLayout()
        cb_stats_line.setContentsMargins(0, 4, 0, 0)
        cb_stats_line.setSpacing(8)

        add_stat_col(
            cb_stats_line,
            comeback_wins,
            "Wundersiege",
            Styles.COLOR_ACCENT,
            subcategory="comeback_wins",
        )
        add_stat_col(
            cb_stats_line,
            comeback_draws,
            "Gerettete Remis",
            Styles.COLOR_TEXT_PRIMARY,
            subcategory="comeback_draws",
        )
        add_stat_col(cb_stats_line, lost_deficit, "Niederlagen", Styles.COLOR_TEXT_SECONDARY)
        cb_vbox.addLayout(cb_stats_line)

        hero_row.addWidget(comeback_pillar)
        main_vbox.addLayout(hero_row)

        # ═══════════════════════════════════════════════════════════════
        #  2. BOTTOM INSIGHT BANNER (Clean, non-boxy)
        # ═══════════════════════════════════════════════════════════════
        insight_frame = QFrame()
        insight_frame.setObjectName("conversion_insight_frame")
        insight_frame.setStyleSheet(f"""
            QFrame#conversion_insight_frame {{
                background-color: {Styles.COLOR_SURFACE_LIGHT};
                border: 1px solid {Styles.COLOR_BORDER};
                border-radius: 6px;
                padding: 10px 14px;
            }}
        """)
        ins_layout = QHBoxLayout(insight_frame)
        ins_layout.setContentsMargins(10, 8, 10, 8)
        ins_layout.setSpacing(10)

        # Formulate insight
        if hwa == 0 and hlp == 0:
            verdict_text = "Ausgeglichene Partien: In diesem Filterbereich hat keine Seite einen klaren Vorteil (+3,0 / −3,0 Bauern) erreicht."
            indicator_color = Styles.COLOR_TEXT_SECONDARY
        elif thrown == 0 and hwa > 0:
            verdict_text = "Eiskalter Vollstrecker: Jeder Gewinnvorteil wurde zum Sieg oder sicheren Remis geführt – keine einzige Partie verschenkt."
            indicator_color = Styles.COLOR_RESULT_WIN
        elif thrown >= 2 or (hwa > 0 and (thrown / hwa) >= 0.20):
            verdict_text = f"Hohe Schwankungen: {thrown} Partien gingen aus Gewinnstellungen (≥ +3,0 Bauern) verloren. Vereinfache im Vorteil und achte auf Königssicherheit."
            indicator_color = Styles.COLOR_BLUNDER
        elif comeback_rate >= 25.0 and hlp >= 3:
            verdict_text = f"Zäher Verteidiger: {comeback_rate:.0f}% der verlorenen Stellungen gerettet ({comeback_total}-mal). Starke Moral und Einfallsreichtum unter Druck."
            indicator_color = Styles.COLOR_ACCENT
        else:
            verdict_text = f"Solide Verwertung: {conv_rate:.0f}% der Gewinnvorteile verwertet – mit zuverlässiger Endspieltechnik."
            indicator_color = Styles.COLOR_TEXT_PRIMARY

        ins_lbl = QLabel(verdict_text)
        ins_lbl.setWordWrap(True)
        ins_lbl.setStyleSheet(f"""
            color: {indicator_color if indicator_color == Styles.COLOR_BLUNDER else Styles.COLOR_TEXT_SECONDARY};
            font-size: 11px;
            font-weight: 500;
            line-height: 1.35;
            background: transparent;
        """)
        ins_layout.addWidget(ins_lbl, stretch=1)

        main_vbox.addWidget(insight_frame)
        self.set_content(self.content_widget)

    def refresh_styles(self):
        self.action_badge.setStyleSheet(f"""
            background-color: {Styles.COLOR_SURFACE_LIGHT};
            color: {Styles.COLOR_TEXT_SECONDARY};
            font-size: 11px;
            font-weight: 600;
            border: 1px solid {Styles.COLOR_BORDER};
            border-radius: 6px;
            padding: 3px 8px;
        """)
        super().refresh_styles()
        self._render_view()
