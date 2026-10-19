from PyQt6.QtCore import QTimer

from src.gui.components.tour_manager import TourStep


class TourMixin:
    """Page switching, tour orchestration, and tour step definitions."""

    def switch_page(self, index):
        QTimer.singleShot(0, lambda: self._do_switch_page(index))

    def _do_switch_page(self, index):
        self.stack.setCurrentIndex(index)
        if index == 2 and hasattr(self, "history_view"):
            analyzing_id = (
                self.current_game.game_id
                if hasattr(self, "worker")
                and self.worker
                and self.worker.isRunning()
                and self.current_game
                else None
            )
            self.history_view.set_analyzing_game_id(analyzing_id)
            self.history_view.load_history()
        if index == 3 and hasattr(self, "metrics_view") and self.metrics_view.needs_refresh:
            self.metrics_view.refresh()
        if index == 5 and hasattr(self, "profile_view") and self.profile_view.needs_refresh:
            self.profile_view.refresh()
        # If a tour is active, close it silently (don't mark seen — user didn't finish it).
        if hasattr(self, "tour_overlay") and self.tour_overlay.isVisible():
            self.tour_overlay.close_silently()
        # Auto-start the tour the first time the user visits this page.
        if not self.tour_manager.has_seen_tour(index):
            QTimer.singleShot(400, lambda idx=index: self._auto_start_tour(idx))

    def _auto_start_tour(self, page_index: int):
        """Start tour on first visit only — guards against delayed mis-fires."""
        if self.stack.currentIndex() != page_index:
            return  # user navigated away during the 400ms delay
        if self.tour_manager.has_seen_tour(page_index):
            return  # already seen (e.g. Ctrl+T was pressed and dismissed)

        # For page 0 without a loaded game, allow the landing tour once per session.
        if page_index == 0 and self.current_game is None:
            if getattr(self, "_seen_empty_tour", False):
                return
            self._seen_empty_tour = True

        # Skip tour if the page has no relevant data yet (don't mark seen,
        # so the tour retriggers on next visit once data becomes available).
        if page_index == 2 and hasattr(self, "history_view") and not self.history_view.games:
            return
        if page_index == 3 and hasattr(self, "metrics_view"):
            mv = self.metrics_view
            if not any(
                hasattr(mv, attr) and getattr(mv, attr) and getattr(mv, attr).isVisible()
                for attr in ("stats_container", "accuracy_card", "openings_card", "quality_card")
            ):
                return

        self._launch_tour(page_index)

    def start_tour(self):
        """Ctrl+T: start/replay tour for the currently active page."""
        index = self.stack.currentIndex()
        self._launch_tour(index)

    def _launch_tour(self, page_index: int):
        """Build steps and show the tour overlay for the given page."""
        steps = self._build_tour_steps(page_index)
        if not steps:
            return
        self._tour_page = page_index  # remember the originating page
        self.tour_overlay.setGeometry(self.rect())
        self.tour_manager.start(steps)
        self.tour_overlay.show_tour()

    def _on_tour_finished(self):
        """Called when the tour overlay closes. Uses the page the tour *started*
        on so a mid-tour page switch doesn't mark the wrong page.
        """
        page_index = getattr(self, "_tour_page", self.stack.currentIndex())
        # If finishing page 0 while on empty state, do not mark page 0 as seen so that
        # when a game is loaded, the full analysis workspace tour will still introduce the panels.
        if page_index == 0 and self.current_game is None:
            return
        self.tour_manager.mark_seen(page_index)

    def _build_tour_steps(self, page_index: int) -> list:
        """Return a list of TourStep objects tailored to the visible page."""
        ev = self.explorer_view
        hv = self.history_view
        sv = self.settings_view
        mv = self.metrics_view
        steps = []

        if page_index == 0:  # ── Analysis ───────────────────────────────────
            if self.current_game is None:
                # Hero focus empty-state landing view
                if hasattr(self, "board_widget"):
                    steps.append(
                        TourStep(
                            target=self.board_widget,
                            title="Interaktives Schachbrett",
                            text="Willkommen bei Chess Analyzer Pro! Zieh eine .pgn-Datei direkt aufs Brett oder füge eine Partie mit Strg+V aus der Zwischenablage ein.",
                            position="right",
                            page_index=0,
                        )
                    )
                if hasattr(self, "btn_hero_load"):
                    steps.append(
                        TourStep(
                            target=self.btn_hero_load,
                            title="Partie laden",
                            text="Über „Partie laden“ öffnest du PGN-Dateien, fügst Züge als Text ein oder importierst Partien direkt von Chess.com und Lichess.",
                            position="below",
                            page_index=0,
                        )
                    )
                if hasattr(self, "sidebar"):
                    steps.append(
                        TourStep(
                            target=self.sidebar,
                            title="Navigation",
                            text="In der Seitenleiste erreichst du den Eröffnungs-Explorer, deinen Partienverlauf, dein Spielerprofil, die Statistiken und die Einstellungen.",
                            position="right",
                            page_index=0,
                        )
                    )
            else:
                # Full 3-column analysis workspace
                if hasattr(self, "btn_load"):
                    steps.append(
                        TourStep(
                            target=self.btn_load,
                            title="Partie laden",
                            text="Lade jederzeit neue Partien aus Dateien, aus der Zwischenablage oder von deinen Online-Konten.",
                            position="below",
                            page_index=0,
                        )
                    )
                if hasattr(self, "btn_analyze"):
                    steps.append(
                        TourStep(
                            target=self.btn_analyze,
                            title="Engine-Analyse",
                            text="„Partie analysieren“ startet Stockfish. Nach einer Pause macht „Analyse fortsetzen“ genau dort weiter. Fertige Partien kannst du erneut analysieren.",
                            position="below",
                            page_index=0,
                        )
                    )
                if hasattr(self, "board_widget"):
                    steps.append(
                        TourStep(
                            target=self.board_widget,
                            title="Analysebrett",
                            text="Zeigt die Züge mit Bewertungsbalken, Pfeilen für den besten Zug, Drohungen und der aktuellen Materialbilanz.",
                            position="right",
                            page_index=0,
                        )
                    )
                if hasattr(self, "move_list_panel"):
                    steps.append(
                        TourStep(
                            target=self.move_list_panel,
                            title="Zugliste & Bewertungen",
                            text="Farbige Zugliste mit Bewertungs-Symbolen (Brillant, Großartig, Bester Zug, Ungenauigkeit, Fehler, Patzer) und Engine-Varianten.",
                            position="left",
                            page_index=0,
                        )
                    )
                if hasattr(self, "analysis_panel"):
                    steps.append(
                        TourStep(
                            target=self.analysis_panel,
                            title="Analyse-Übersicht",
                            text="Bewertungsverlauf (Klick auf einen Zug springt dorthin), Genauigkeitsanzeigen und Partiebesprechungen durch den KI-Coach.",
                            position="left",
                            page_index=0,
                        )
                    )
                if hasattr(self, "controls"):
                    steps.append(
                        TourStep(
                            target=self.controls,
                            title="Wiedergabe-Steuerung",
                            text="Geh mit den Pfeiltasten durch die Züge, spring zum Anfang oder Ende, dreh das Brett oder spiel die Partie automatisch ab.",
                            position="above",
                            page_index=0,
                        )
                    )
                if hasattr(self, "btn_explore"):
                    steps.append(
                        TourStep(
                            target=self.btn_explore,
                            title="Eröffnungs-Explorer",
                            text="„Im Explorer öffnen“ zeigt die aktuelle Stellung im Eröffnungs-Explorer mit Meisterfortsetzungen und Buchstatistiken.",
                            position="below",
                            page_index=0,
                        )
                    )

        elif page_index == 1:  # ── Explorer ────────────────────────────────
            if hasattr(ev, "header_bar") and ev.header_bar.isVisible():
                steps.append(
                    TourStep(
                        target=ev.header_bar,
                        title="Eröffnungserkennung",
                        text="Zeigt ECO-Code und Namen der aktuellen Eröffnung und aktualisiert sich mit jedem Zug.",
                        position="below",
                        page_index=1,
                    )
                )
            if hasattr(ev, "board_widget") and ev.board_widget.isVisible():
                steps.append(
                    TourStep(
                        target=ev.board_widget,
                        title="Übungsbrett",
                        text="Freies Übungsbrett: Spiel Züge, teste Alternativen oder studiere Fortsetzungen mit Live-Bewertung durch Stockfish.",
                        position="right",
                        page_index=1,
                    )
                )
            if hasattr(ev, "chk_classify") and ev.chk_classify.isVisible():
                steps.append(
                    TourStep(
                        target=ev.chk_classify,
                        title="Zugbewertung",
                        text="Mit „Züge bewerten“ bekommt jeder getestete Zug sofort eine Bewertung wie Brillant, Großartig oder Patzer.",
                        position="below",
                        page_index=1,
                    )
                )
            if hasattr(ev, "book_toggle") and ev.book_toggle.isVisible():
                steps.append(
                    TourStep(
                        target=ev.book_toggle,
                        title="Eröffnungsbuch",
                        text="Buchzüge fragt die Lichess-Datenbanken (Meister & Online) ab – mit Sieg/Remis/Niederlage-Balken und Zugstatistiken.",
                        position="left",
                        page_index=1,
                    )
                )
            if hasattr(ev, "move_input") and ev.move_input.isVisible():
                steps.append(
                    TourStep(
                        target=ev.move_input,
                        title="Zugeingabe",
                        text="Gib Züge in SAN-Notation ein (z. B. „e4“, „Nf3“, „O-O“), um schnell zu jeder Variante zu springen.",
                        position="left",
                        page_index=1,
                    )
                )
            if hasattr(ev, "btn_flip") and ev.btn_flip.isVisible():
                steps.append(
                    TourStep(
                        target=ev.btn_flip,
                        title="Brett-Werkzeuge",
                        text="Mit Brett drehen, FEN kopieren und PGN kopieren kannst du jede Stellung exportieren, analysieren oder teilen.",
                        position="below",
                        page_index=1,
                    )
                )

        elif page_index == 2:  # ── History ──────────────────────────────────
            if hasattr(hv, "search_input") and hv.search_input.isVisible():
                steps.append(
                    TourStep(
                        target=hv.search_input,
                        title="Sofortsuche",
                        text="Durchsuche deinen Partienverlauf nach Spielername, Eröffnung, ECO-Code, Turnier oder Datum.",
                        position="below",
                        page_index=2,
                    )
                )
            if hasattr(hv, "result_filter") and hv.result_filter.isVisible():
                steps.append(
                    TourStep(
                        target=hv.result_filter,
                        title="Ergebnisfilter",
                        text="Filtere Partien nach Ergebnis: Siege, Niederlagen oder Remis.",
                        position="below",
                        page_index=2,
                    )
                )
            if hasattr(hv, "type_filter") and hv.type_filter.isVisible():
                steps.append(
                    TourStep(
                        target=hv.type_filter,
                        title="Bedenkzeit-Filter",
                        text="Filtere Partien nach Bedenkzeit: Schnellschach, Blitz, Bullet, Klassisch oder Fernschach.",
                        position="below",
                        page_index=2,
                    )
                )
            if hasattr(hv, "source_filter") and hv.source_filter.isVisible():
                steps.append(
                    TourStep(
                        target=hv.source_filter,
                        title="Quelle",
                        text="Filtere Partien nach Herkunft: Chess.com, Lichess oder importierte Dateien.",
                        position="below",
                        page_index=2,
                    )
                )
            if hasattr(hv, "btn_import") and hv.btn_import.isVisible():
                steps.append(
                    TourStep(
                        target=hv.btn_import,
                        title="Massenimport",
                        text="„Importieren“ lädt ganze Partiearchive aus CSV-Dateien im Hintergrund in deine lokale Datenbank.",
                        position="left",
                        page_index=2,
                    )
                )
            if hasattr(hv, "btn_export") and hv.btn_export.isVisible():
                steps.append(
                    TourStep(
                        target=hv.btn_export,
                        title="Partien exportieren",
                        text="„Exportieren“ sichert deinen gesamten Verlauf samt Analysen als CSV-Datei – ideal als Backup.",
                        position="left",
                        page_index=2,
                    )
                )
            if hasattr(hv, "btn_clear") and hv.btn_clear.isVisible():
                steps.append(
                    TourStep(
                        target=hv.btn_clear,
                        title="Verlauf leeren",
                        text="„Leeren“ löscht deinen gespeicherten Verlauf. Exportiere vorher ein Backup, wenn du die Daten behalten willst.",
                        position="left",
                        page_index=2,
                    )
                )
            if hasattr(hv, "game_list") and hv.game_list.isVisible():
                steps.append(
                    TourStep(
                        target=hv.game_list,
                        title="Partiearchiv",
                        text="Deine gespeicherten Partien mit Genauigkeit, Partieende, Live-Fortschritt („Wird analysiert …“) und Schnellaktionen zum Analysieren oder Fortsetzen.",
                        position="above",
                        page_index=2,
                    )
                )

        elif page_index == 3:  # ── Stats ────────────────────────────────────
            if hasattr(mv, "btn_refresh") and mv.btn_refresh.isVisible():
                steps.append(
                    TourStep(
                        target=mv.btn_refresh,
                        title="Statistiken aktualisieren",
                        text="Die Statistiken werden beim Öffnen der Seite berechnet. „Aktualisieren“ bezieht neu analysierte Partien ein.",
                        position="left",
                        page_index=3,
                    )
                )
            if hasattr(mv, "filter_bar") and mv.filter_bar.isVisible():
                steps.append(
                    TourStep(
                        target=mv.filter_bar,
                        title="Filter",
                        text="Filtere deine Auswertung nach Farbe (Weiß/Schwarz), Format (Schnellschach, Blitz, Bullet, Chess960), Quelle und Zeitraum.",
                        position="below",
                        page_index=3,
                    )
                )
            if hasattr(mv, "stats_container") and mv.stats_container.isVisible():
                steps.append(
                    TourStep(
                        target=mv.stats_container,
                        title="Leistungsübersicht",
                        text="Die wichtigsten Kennzahlen: Partien, Siegquote und durchschnittliche Genauigkeit. „Patzer / Partie“ und „Fehlerfreie Partien“ sind klickbar und führen zu den konkreten Stellungen!",
                        position="below",
                        page_index=3,
                    )
                )
            if hasattr(mv, "accuracy_card") and mv.accuracy_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.accuracy_card,
                        title="Genauigkeitsverlauf",
                        text="Zeigt, wie sich deine durchschnittliche Genauigkeit über die Zeit entwickelt. Wird dein Spiel besser, steigt die Linie.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "phase_card") and mv.phase_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.phase_card,
                        title="Leistung nach Partiephase",
                        text="Bewertet deine Genauigkeit getrennt nach Eröffnung, Mittelspiel und Endspiel.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "ending_card") and mv.ending_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.ending_card,
                        title="Partieenden",
                        text="Zeigt, wie deine Partien enden: Schachmatt, Aufgabe, Zeitüberschreitung, Patt oder Remis.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "quality_card") and mv.quality_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.quality_card,
                        title="Zugqualität",
                        text="Ringdiagramm mit deinem Anteil an brillanten, großartigen und besten Zügen sowie Ungenauigkeiten, Fehlern und Patzern.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "hanging_card") and mv.hanging_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.hanging_card,
                        title="Eingestellte Figuren",
                        text="Verpasste Taktik & hängende Figuren: Klick auf die Karte, um alle taktischen Fehler am Brett durchzugehen.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "tactics_card") and mv.tactics_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.tactics_card,
                        title="Taktische Motive",
                        text="Erkennt Fesselungen, Gabeln, Spieße und Abzugsangriffe. Klick auf ein Motiv, um die genauen Stellungen zu sehen.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "advantage_card") and mv.advantage_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.advantage_card,
                        title="Vorteilsverwertung",
                        text="Wie oft verwertest du Gewinnstellungen, wie oft verspielst du den Vorteil? Klick, um verspielte Stellungen anzusehen.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "openings_card") and mv.openings_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.openings_card,
                        title="Top-Eröffnungen",
                        text="Deine meistgespielten Eröffnungen mit Siegquote. Klick auf eine Eröffnung, um alle Partien damit zu sehen.",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "brilliancy_card") and mv.brilliancy_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.brilliancy_card,
                        title="Ruhmeshalle der Glanzzüge",
                        text="Deine besten brillanten Züge und Opfer. Klick auf eine Karte, um direkt zu dieser Stellung zu springen!",
                        position="above",
                        page_index=3,
                    )
                )
            if hasattr(mv, "ai_coach_card") and mv.ai_coach_card.isVisible():
                steps.append(
                    TourStep(
                        target=mv.ai_coach_card,
                        title="KI-Coach",
                        text="Persönliche Diagnose, wiederkehrende Fehlermuster und Trainingsschwerpunkte – erstellt von deinem eingerichteten Sprachmodell.",
                        position="above",
                        page_index=3,
                    )
                )
            if not steps:
                steps.append(
                    TourStep(
                        target=mv,
                        title="Statistik-Übersicht",
                        text="Deine persönliche Statistik mit Genauigkeitsverlauf, klickbaren Detailansichten, Taktik-Karten und KI-Coach. Trag deine Benutzernamen in den Einstellungen ein oder analysiere Partien, um sie zu füllen.",
                        position="below",
                        page_index=3,
                    )
                )

        elif page_index == 4:  # ── Settings ─────────────────────────────────
            mode_btn = getattr(sv, "mode_toggle_btn", None)
            eng = getattr(sv, "engine_settings", None)
            app = getattr(sv, "appearance_settings", None)
            api = getattr(sv, "api_settings", None)
            ply = getattr(sv, "player_settings", None)
            bok = getattr(sv, "book_settings", None)
            dat = getattr(sv, "data_settings", None)
            lnk = getattr(sv, "links_settings", None)
            save_btn = getattr(sv, "save_settings_btn", None)

            if mode_btn and mode_btn.isVisible():
                steps.append(
                    TourStep(
                        target=mode_btn,
                        title="Einstellungsmodus",
                        text="Wechsle zwischen Grundeinstellungen und erweiterten Einstellungen für Engine-Speicher, Threads, Multi-PV und Cache.",
                        position="below",
                        page_index=4,
                    )
                )
            if eng and eng.isVisible():
                steps.append(
                    TourStep(
                        target=eng,
                        title="Stockfish-Engine",
                        text="Lege den Pfad zu Stockfish fest (oder lade die Engine automatisch herunter) und stelle Analysetiefe und Threads ein.",
                        position="below",
                        page_index=4,
                    )
                )
            if app and app.isVisible():
                steps.append(
                    TourStep(
                        target=app,
                        title="Darstellung",
                        text="Wechsle zwischen dunklem und hellem Design, wähle Brett- und Figurenstil, eine Akzentfarbe und schalte Soundeffekte ein oder aus.",
                        position="below",
                        page_index=4,
                    )
                )
            if api and api.isVisible():
                steps.append(
                    TourStep(
                        target=api,
                        title="KI-Coach & Sprachmodell",
                        text="Verwalte Sprachmodell-Profile (Groq, OpenAI, LM Studio, MiniMax) für den KI-Coach und deinen persönlichen Lichess-Zugangstoken.",
                        position="above",
                        page_index=4,
                    )
                )
            if ply and ply.isVisible():
                steps.append(
                    TourStep(
                        target=ply,
                        title="Spielerkonten",
                        text="Trag deine Benutzernamen für Chess.com und Lichess ein – für automatische Statistiken und Partie-Import mit einem Klick.",
                        position="above",
                        page_index=4,
                    )
                )
            if bok and bok.isVisible():
                steps.append(
                    TourStep(
                        target=bok,
                        title="Eröffnungsbuch",
                        text="Binde optional ein Polyglot-Eröffnungsbuch (.bin) ein, um sofort Buchzüge auf Meisterniveau zu erhalten.",
                        position="above",
                        page_index=4,
                    )
                )
            if dat and dat.isVisible():
                steps.append(
                    TourStep(
                        target=dat,
                        title="Daten & Speicher",
                        text="Zeigt die Größe der Datenbanken, leert zwischengespeicherte Engine-Bewertungen und verwaltet lokale App-Daten.",
                        position="above",
                        page_index=4,
                    )
                )
            if lnk and lnk.isVisible():
                steps.append(
                    TourStep(
                        target=lnk,
                        title="Updates & Support",
                        text="Nach Updates suchen, die App bewerten, Ideen einreichen oder Fehler mit Diagnose-Logs melden.",
                        position="above",
                        page_index=4,
                    )
                )
            if save_btn and save_btn.isVisible():
                steps.append(
                    TourStep(
                        target=save_btn,
                        title="Einstellungen speichern",
                        text="„Einstellungen speichern“ übernimmt und sichert alle Änderungen.",
                        position="left",
                        page_index=4,
                    )
                )
            if not steps:  # fallback
                steps.append(
                    TourStep(
                        target=sv,
                        title="Einstellungen",
                        text="Hier stellst du Stockfish-Pfad, Analysetiefe, KI-Anbieter, Brettdesign und Figurenstil ein.",
                        position="below",
                        page_index=4,
                    )
                )

        elif page_index == 5:  # ── Mein Profil ──────────────────────────────
            pv = getattr(self, "profile_view", None)
            if pv is not None:
                btn_import = getattr(pv, "btn_import", None)
                btn_batch = getattr(pv, "btn_batch", None)
                speed_combo = getattr(pv, "speed_combo", None)
                scroll = getattr(pv, "scroll", None)
                if btn_import and btn_import.isVisible():
                    steps.append(
                        TourStep(
                            target=btn_import,
                            title="Partien importieren",
                            text="Lade deine Partien per Chess.com-Benutzername oder aus PGN-Dateien. Sie landen direkt in deinem Verlauf.",
                            position="below",
                            page_index=5,
                        )
                    )
                if btn_batch and btn_batch.isVisible():
                    steps.append(
                        TourStep(
                            target=btn_batch,
                            title="Alle analysieren",
                            text="Analysiert alle noch offenen Partien nacheinander mit Stockfish im Hintergrund. Du kannst jederzeit abbrechen und später weitermachen.",
                            position="below",
                            page_index=5,
                        )
                    )
                if speed_combo and speed_combo.isVisible():
                    steps.append(
                        TourStep(
                            target=speed_combo,
                            title="Analyse-Tempo",
                            text="Wähle, wie viel Engine-Zeit jeder Zug bekommt: schneller für viele Partien, gründlicher für genauere Ergebnisse.",
                            position="below",
                            page_index=5,
                        )
                    )
                if scroll and scroll.isVisible():
                    steps.append(
                        TourStep(
                            target=scroll,
                            title="Dein Spielerprofil",
                            text="Hier siehst du dein Fähigkeiten-Radar, Stärken und Schwächen, deinen Spielstil und wiederkehrende Muster mit anklickbaren Beispielpartien. Der Trainingsplan zeigt, woran du arbeiten solltest – mit „Eigene Fehler trainieren“ übst du Stellungen aus deinen eigenen Partien.",
                            position="above",
                            page_index=5,
                        )
                    )
                if not steps:
                    steps.append(
                        TourStep(
                            target=pv,
                            title="Mein Profil",
                            text="Importiere und analysiere deine Partien, um ein Spielerprofil mit Stärken, Schwächen und Trainingsplan zu erhalten.",
                            position="below",
                            page_index=5,
                        )
                    )

        return steps
