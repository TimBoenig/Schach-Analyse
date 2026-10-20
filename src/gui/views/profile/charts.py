"""
Matplotlib canvases for the profile page (skill radar, monthly trend, rating curve).
"""

from __future__ import annotations

import datetime
import math

from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg
from matplotlib.figure import Figure

from src.backend.analysis.profile import SkillScore
from src.gui.styles import Styles


def _canvas(fig: Figure, height: int) -> FigureCanvasQTAgg:
    canvas = FigureCanvasQTAgg(fig)
    canvas.setStyleSheet("background: transparent;")
    canvas.setMinimumHeight(height)
    return canvas


def _style_axes(ax) -> None:
    ax.set_facecolor("none")
    ax.tick_params(colors=Styles.COLOR_TEXT_SECONDARY, labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(Styles.COLOR_BORDER)
    ax.grid(True, color=Styles.COLOR_BORDER, linewidth=0.6, alpha=0.6)


def skill_radar(skills: list[SkillScore]) -> FigureCanvasQTAgg:
    fig = Figure(figsize=(4.2, 4.2), dpi=100, facecolor="none")
    ax = fig.add_subplot(111, polar=True)
    ax.set_facecolor("none")
    labels = [s.name for s in skills]
    values = [s.score for s in skills]
    angles = [i / len(skills) * 2 * math.pi for i in range(len(skills))]
    ax.plot(angles + angles[:1], values + values[:1], color=Styles.COLOR_ACCENT, linewidth=2)
    ax.fill(angles + angles[:1], values + values[:1], color=Styles.COLOR_ACCENT, alpha=0.25)
    for a, s in zip(angles, skills, strict=True):
        if not s.reliable:
            ax.plot([a], [s.score], "o", color=Styles.COLOR_TEXT_MUTED, markersize=5)
    ax.set_xticks(angles)
    ax.set_xticklabels(labels, color=Styles.COLOR_TEXT_PRIMARY, fontsize=8)
    ax.set_ylim(0, 100)
    ax.set_yticks([25, 50, 75])
    ax.set_yticklabels([])
    ax.grid(color=Styles.COLOR_BORDER, linewidth=0.7)
    ax.spines["polar"].set_color(Styles.COLOR_BORDER)
    fig.subplots_adjust(left=0.14, right=0.86, top=0.88, bottom=0.12)
    return _canvas(fig, 320)


def monthly_trend(monthly: list[dict]) -> FigureCanvasQTAgg:
    fig = Figure(figsize=(5.5, 2.6), dpi=100, facecolor="none")
    ax = fig.add_subplot(111)
    _style_axes(ax)
    labels = [m["month"][2:].replace("-", "/") for m in monthly]
    acc = [m["avg_accuracy"] if m["avg_accuracy"] is not None else math.nan for m in monthly]
    score = [m["score_pct"] for m in monthly]
    x = list(range(len(monthly)))
    ax.plot(x, acc, marker="o", color=Styles.COLOR_ACCENT, label="Ø Genauigkeit")
    ax.plot(x, score, marker="s", color=Styles.COLOR_RESULT_WIN, label="Punkte-Quote", alpha=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=0 if len(x) <= 8 else 45, fontsize=8)
    ax.set_ylim(0, 100)
    ax.set_ylabel("%", color=Styles.COLOR_TEXT_SECONDARY, fontsize=8)
    leg = ax.legend(fontsize=8, frameon=False, loc="lower left")
    for text in leg.get_texts():
        text.set_color(Styles.COLOR_TEXT_SECONDARY)
    fig.tight_layout()
    return _canvas(fig, 220)


def rating_curve(ratings: dict[str, list[tuple[float, int]]]) -> FigureCanvasQTAgg:
    fig = Figure(figsize=(5.5, 2.6), dpi=100, facecolor="none")
    ax = fig.add_subplot(111)
    _style_axes(ax)
    palette = [
        Styles.COLOR_ACCENT,
        Styles.COLOR_RESULT_WIN,
        Styles.COLOR_INACCURACY,
        Styles.COLOR_GREAT,
    ]
    for i, (speed, points) in enumerate(ratings.items()):
        xs = [datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc) for ts, _ in points]
        ys = [r for _, r in points]
        ax.plot(xs, ys, color=palette[i % len(palette)], linewidth=1.6, label=speed)
    fig.autofmt_xdate()
    leg = ax.legend(fontsize=8, frameon=False)
    for text in leg.get_texts():
        text.set_color(Styles.COLOR_TEXT_SECONDARY)
    fig.tight_layout()
    return _canvas(fig, 220)
