"""
GUI tests for the profile page, the game review tab and the profile sidebar entry.
"""

from unittest.mock import MagicMock

from src.backend.analysis.profile import build_player_profile
from src.gui.analysis.game_review_widget import GameReviewWidget, _MomentCard
from src.gui.components.sidebar import Sidebar
from src.gui.views.profile import ProfileView
from tests.profile_fixtures import build_moves, game_analysis, game_row


def _config(username: str = "Tim"):
    cfg = MagicMock()
    cfg.get.side_effect = lambda key, default="": (
        username if key == "chesscom_username" else default
    )
    return cfg


def test_profile_view_requires_username(qapp, qtbot):
    view = ProfileView(_config(""))
    qtbot.addWidget(view)
    with qtbot.waitSignal(view.request_settings, timeout=1000):
        view.refresh(force=True)
        button = next(
            b
            for b in view.findChildren(type(view.btn_import))
            if b.text().strip() == "Zu den Einstellungen"
        )
        button.click()


def test_profile_view_renders_profile_and_opens_examples(qapp, qtbot):
    thrown = {15: ("Blunder", 0.85), 16: ("Blunder", 0.25)}
    rows = [game_row(f"g{i}", build_moves(thrown), result="0-1") for i in range(10)]
    view = ProfileView(_config())
    qtbot.addWidget(view)
    view.profile = build_player_profile(rows, ["Tim"])
    view.render()

    titles = {b.text() for b in view.findChildren(type(view.btn_import))}
    assert any(
        t.startswith("Eigene Fehler trainieren (10)") or "Eigene Fehler trainieren (10)" in t
        for t in titles
    )

    example = next(
        b for b in view.findChildren(type(view.btn_import)) if b.text().startswith("9. d5")
    )
    with qtbot.waitSignal(view.game_requested, timeout=1000) as sig:
        example.click()
    assert sig.args[1] == 16 and sig.args[0].startswith("g")


def test_game_review_widget_emits_clicked_moment(qapp, qtbot, mocker):
    widget = GameReviewWidget(_config())
    qtbot.addWidget(widget)
    widget.show()
    widget.set_game(game_analysis(build_moves({15: ("Blunder", 0.85), 16: ("Blunder", 0.25)})))

    assert widget.user_color() == "white" and widget.btn_white.isChecked()
    cards = widget.findChildren(_MomentCard)
    assert cards
    with qtbot.waitSignal(widget.move_clicked, timeout=1000) as sig:
        cards[-1].clicked.emit()
    assert sig.args == [16]

    widget.btn_black.click()  # switch perspective: review is rebuilt for Black
    assert widget.review is not None and widget.review.user_color == "black"


def test_sidebar_profile_entry_maps_to_page_five(qapp, qtbot):
    sidebar = Sidebar()
    qtbot.addWidget(sidebar)
    profile_btn = next(b for b in sidebar._nav_buttons if "Profil" in b.text())
    with qtbot.waitSignal(sidebar.page_changed, timeout=1000) as sig:
        profile_btn.click()
    assert sig.args == [5]
    assert profile_btn.isChecked()
