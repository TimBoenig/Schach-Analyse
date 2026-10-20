"""
Error dialog for when the LLM is not configured,
offering Configure Now and Skip actions.
"""

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QDialog, QHBoxLayout, QLabel, QPushButton, QVBoxLayout

from ..styles import Styles


class LlmNotConfiguredDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("LLM nicht eingerichtet")
        self.setFixedSize(440, 220)
        self.setStyleSheet(f"""
            QDialog {{
                background-color: {Styles.COLOR_BACKGROUND};
                color: {Styles.COLOR_TEXT_PRIMARY};
            }}
        """)

        self._configured = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 20)
        layout.setSpacing(14)

        title = QLabel("KI-Funktionen müssen eingerichtet werden")
        title.setStyleSheet(
            f"font-size: 17px; font-weight: bold; color: {Styles.COLOR_TEXT_PRIMARY}; "
            f"background: transparent;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)

        desc = QLabel(
            "KI-gestützte Analysen (Zusammenfassungen, Coach-Tipps und Zugerklärungen) "
            "brauchen einen API-Schlüssel eines LLM-Anbieters. Du kannst ihn in den "
            "Einstellungen hinterlegen."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet(
            f"font-size: 13px; color: {Styles.COLOR_TEXT_SECONDARY}; background: transparent;"
        )
        desc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(desc)

        layout.addStretch()

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        self._skip_btn = QPushButton("Überspringen")
        self._skip_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._skip_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {Styles.COLOR_SURFACE_LIGHT};
                color: {Styles.COLOR_TEXT_SECONDARY};
                border: 1px solid {Styles.COLOR_BORDER};
                padding: 8px 20px;
                border-radius: 6px;
                font-size: 13px;
            }}
            QPushButton:hover {{
                background-color: {Styles.COLOR_SURFACE};
                border-color: {Styles.COLOR_ACCENT};
            }}
        """)
        self._skip_btn.clicked.connect(self.reject)
        btn_layout.addWidget(self._skip_btn)

        btn_layout.addSpacing(12)

        self._configure_btn = QPushButton("  Jetzt einrichten")
        self._configure_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._configure_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {Styles.COLOR_ACCENT};
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
            }}
            QPushButton:hover {{
                background-color: {Styles.COLOR_ACCENT_HOVER};
            }}
        """)
        self._configure_btn.clicked.connect(self._on_configure)
        btn_layout.addWidget(self._configure_btn)

        layout.addLayout(btn_layout)

    def _on_configure(self):
        self._configured = True
        self.accept()

    def wants_configure(self) -> bool:
        return self._configured
