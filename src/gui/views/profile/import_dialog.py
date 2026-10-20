"""
Dialog to choose a bulk import source for the profile: chess.com archives or PGN files.
"""

from __future__ import annotations

from PyQt6.QtWidgets import (
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from src.gui.styles import Styles
from src.gui.utils.gui_utils import create_button, create_combobox
from src.utils.logger import logger

MONTH_OPTIONS: dict[str, int | None] = {
    "Letzter Monat": 1,
    "Letzte 3 Monate": 3,
    "Letzte 6 Monate": 6,
    "Letzte 12 Monate": 12,
    "Alle Partien": None,
}


class ProfileImportDialog(QDialog):
    """Collects import parameters; the import itself runs in ImportWorker."""

    def __init__(self, username: str = "", parent=None):
        super().__init__(parent)
        self.setWindowTitle("Partien importieren")
        self.setMinimumWidth(520)
        self.setStyleSheet(Styles.get_dialog_surface_style())
        self.username = ""
        self.months: int | None = 6
        self.pgn_text = ""

        layout = QVBoxLayout(self)
        intro = QLabel(
            "Importiere möglichst viele deiner Partien – je mehr Partien analysiert sind, "
            "desto genauer wird dein Profil."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet(Styles.get_secondary_label_style())
        layout.addWidget(intro)

        self.tabs = QTabWidget()
        self.tabs.setStyleSheet(Styles.get_tab_style())
        layout.addWidget(self.tabs)

        # chess.com tab
        cc = QWidget()
        cc_l = QVBoxLayout(cc)
        cc_l.addWidget(QLabel("chess.com-Benutzername"))
        self.user_input = QLineEdit(username)
        self.user_input.setPlaceholderText("z. B. MagnusCarlsen")
        self.user_input.setStyleSheet(Styles.get_line_edit_style())
        cc_l.addWidget(self.user_input)
        cc_l.addWidget(QLabel("Zeitraum"))
        self.months_combo = create_combobox(list(MONTH_OPTIONS), current="Letzte 6 Monate")
        cc_l.addWidget(self.months_combo)
        hint = QLabel("Es wird die öffentliche chess.com-API genutzt – kein Login nötig.")
        hint.setStyleSheet(Styles.get_secondary_label_style(size=12))
        cc_l.addWidget(hint)
        cc_l.addStretch()
        self.tabs.addTab(cc, "chess.com")

        # PGN tab
        pgn = QWidget()
        pgn_l = QVBoxLayout(pgn)
        self.lbl_files = QLabel("Keine Dateien ausgewählt")
        self.lbl_files.setWordWrap(True)
        pgn_l.addWidget(self.lbl_files)
        pgn_l.addWidget(
            create_button(
                "PGN-Dateien auswählen …",
                style="secondary",
                on_click=self._choose_files,
                icon_name="fa5s.file-import",
            )
        )
        pgn_l.addStretch()
        self.tabs.addTab(pgn, "PGN-Dateien")

        buttons = QHBoxLayout()
        buttons.addStretch()
        buttons.addWidget(create_button("Abbrechen", style="secondary", on_click=self.reject))
        self.btn_ok = create_button("Importieren", on_click=self._accept, icon_name="fa5s.download")
        buttons.addWidget(self.btn_ok)
        layout.addLayout(buttons)

    def _choose_files(self):
        files, _ = QFileDialog.getOpenFileNames(
            self, "PGN-Dateien auswählen", "", "PGN-Dateien (*.pgn *.txt)"
        )
        if not files:
            return
        texts = []
        for path in files:
            try:
                with open(path, encoding="utf-8", errors="replace") as fh:
                    texts.append(fh.read())
            except OSError as e:
                logger.error("Failed to read PGN %s: %s", path, e)
        self.pgn_text = "\n\n".join(texts)
        self.lbl_files.setText(f"{len(files)} Datei(en) ausgewählt")

    def _accept(self):
        if self.tabs.currentIndex() == 0:
            self.username = self.user_input.text().strip()
            if not self.username:
                self.user_input.setStyleSheet(Styles.get_line_edit_error_style())
                return
            self.months = MONTH_OPTIONS[self.months_combo.currentText()]
            self.pgn_text = ""
        elif not self.pgn_text:
            self.lbl_files.setText("Bitte wähle mindestens eine PGN-Datei aus.")
            return
        else:
            self.username = ""
        self.accept()
