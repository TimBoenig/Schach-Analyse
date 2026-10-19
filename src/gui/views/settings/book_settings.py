"""
Opening Book Settings group component.
"""

import os

from PyQt6.QtWidgets import QFileDialog, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QVBoxLayout

from ...styles import Styles
from .helpers import create_icon_button


class BookSettings(QGroupBox):
    def __init__(self, config_manager, parent=None):
        super().__init__("Eröffnungsbuch", parent)
        self.config_manager = config_manager
        self.setStyleSheet(Styles.get_group_box_style())

        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 25, 20, 20)

        path_layout = QHBoxLayout()
        self.polyglot_path_input = QLineEdit()
        self.polyglot_path_input.setText(self.config_manager.get("polyglot_book_path", ""))
        self.polyglot_path_input.setPlaceholderText("Pfad zum Polyglot-Buch (.bin) … (optional)")
        self.polyglot_path_input.setStyleSheet(Styles.get_input_style())
        path_layout.addWidget(self.polyglot_path_input)

        self.polyglot_browse_btn = create_icon_button(
            "Durchsuchen", "fa5s.folder-open", self.browse_polyglot_book, self
        )
        path_layout.addWidget(self.polyglot_browse_btn)

        self.polyglot_clear_btn = create_icon_button(
            "Leeren", "fa5s.times", self.clear_polyglot_book, self
        )
        path_layout.addWidget(self.polyglot_clear_btn)

        layout.addLayout(path_layout)

        # Polyglot Validation status label
        self.polyglot_validation_label = QLabel()
        self.polyglot_validation_label.setStyleSheet(Styles.get_validation_label_style())
        self.polyglot_validation_label.setWordWrap(True)
        self.polyglot_validation_label.setVisible(False)
        layout.addWidget(self.polyglot_validation_label)

        self.polyglot_path_input.editingFinished.connect(self.validate_polyglot_path)
        self.validate_polyglot_path()

    def browse_polyglot_book(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Polyglot-Eröffnungsbuch wählen", "", "Polyglot-Bücher (*.bin);;Alle Dateien (*)"
        )
        if path:
            self.polyglot_path_input.setText(path)
            self.validate_polyglot_path()

    def clear_polyglot_book(self):
        self.polyglot_path_input.clear()
        self.validate_polyglot_path()

    def validate_polyglot_path(self):
        path = self.polyglot_path_input.text().strip()
        if not path:
            self.polyglot_validation_label.setText(
                "⚠️ Kein Polyglot-Buch angegeben (SQLite-Buch wird verwendet)"
            )
            self.polyglot_validation_label.setStyleSheet(
                f"color: {Styles.COLOR_MISTAKE}; font-size: 12px; font-weight: bold; background: transparent;"
            )
            self.polyglot_validation_label.setVisible(True)
            return

        is_file = os.path.exists(path) and os.path.isfile(path)
        if not is_file:
            self.polyglot_validation_label.setText("❌ Datei existiert nicht")
            self.polyglot_validation_label.setStyleSheet(
                f"color: {Styles.COLOR_BLUNDER}; font-size: 12px; font-weight: bold; background: transparent;"
            )
            self.polyglot_validation_label.setVisible(True)
            return

        if not path.endswith(".bin"):
            self.polyglot_validation_label.setText(
                "❌ Ungültiges Dateiformat (muss ein .bin-Polyglot-Buch sein)"
            )
            self.polyglot_validation_label.setStyleSheet(
                f"color: {Styles.COLOR_BLUNDER}; font-size: 12px; font-weight: bold; background: transparent;"
            )
            self.polyglot_validation_label.setVisible(True)
            return

        try:
            import chess.polyglot

            with chess.polyglot.open_reader(path):
                pass
            self.polyglot_validation_label.setText("✓ Gültiges Polyglot-Eröffnungsbuch")
            self.polyglot_validation_label.setStyleSheet(
                f"color: {Styles.COLOR_BEST}; font-size: 12px; font-weight: bold; background: transparent;"
            )
        except Exception as e:
            self.polyglot_validation_label.setText(
                f"❌ Polyglot-Buch konnte nicht gelesen werden: {str(e)}"
            )
            self.polyglot_validation_label.setStyleSheet(
                f"color: {Styles.COLOR_BLUNDER}; font-size: 12px; font-weight: bold; background: transparent;"
            )

        self.polyglot_validation_label.setVisible(True)

    def reload_from_config(self):
        self.polyglot_path_input.setText(self.config_manager.get("polyglot_book_path", ""))
        self.validate_polyglot_path()

    def set_advanced_visible(self, visible):
        self.setVisible(visible)

    def refresh_styles(self, *args, **kwargs):
        self.setStyleSheet(Styles.get_group_box_style())
        if hasattr(self, "polyglot_path_input"):
            self.polyglot_path_input.setStyleSheet(Styles.get_input_style())
        if hasattr(self, "polyglot_browse_btn"):
            self.polyglot_browse_btn.setStyleSheet(Styles.get_settings_default_button_style())
        if hasattr(self, "polyglot_clear_btn"):
            self.polyglot_clear_btn.setStyleSheet(Styles.get_settings_default_button_style())
        if hasattr(self, "polyglot_validation_label"):
            self.validate_polyglot_path()
