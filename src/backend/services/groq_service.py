"""
Provider-agnostic LLM service using the OpenAI-compatible API.

All supported providers expose an OpenAI-compatible /v1/chat/completions
endpoint, so a single openai.OpenAI client covers them all:

  - Groq       https://api.groq.com/openai/v1
  - LM Studio  http://localhost:1234/v1  (local, no key required)
  - MiniMax    https://api.minimax.chat/v1
  - Custom     any OpenAI-compatible base URL

The class is still named GroqService for backward compatibility with all
existing import sites.
"""

import os
import re

from openai import OpenAI

from src.constants import PROVIDERS
from src.utils.config import ConfigManager
from src.utils.logger import logger

# ---------------------------------------------------------------------------
# Response language
# ---------------------------------------------------------------------------
# The UI is German, so every LLM answer is requested in German and addressed
# to the player informally ("du"), independent of the operating-system locale.
_LANGUAGE_INSTRUCTION = (
    "Antworte ausschließlich auf Deutsch. Sprich den Spieler direkt und informell "
    "in der du-Form an. Verwende die deutsche Schachterminologie "
    "(z. B. Patzer, Fehler, Ungenauigkeit, Gabel, Fesselung, Eröffnung, Endspiel)."
)

# Section labels the summary prompt asks the model to emit verbatim.
_SECTION_LABELS: dict[str, str] = {"game_comment": "Spielkommentar", "summary": "Zusammenfassung"}

# User-visible fallback texts. The "Error" prefix and the "not configured"
# phrase are matched by the GUI (is_error_message / LLM setup dialog), so they
# must stay as-is until the GUI uses a language-neutral error signal.
_NOT_CONFIGURED_MSG = (
    "Error: LLM nicht konfiguriert (not configured). "
    "Richte es unter Einstellungen → API-Konfiguration ein."
)
_NO_RESPONSE_MSG = "Keine Antwort erhalten."


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------


class GroqService:
    """
    OpenAI-compatible LLM service with pluggable, multi-profile provider
    selection.

    Reads its configuration from ConfigManager (active LLM profile).
    The 'client' attribute is non-None when the service is ready to use,
    matching the existing 'if not self.groq_service.client' guard pattern.
    """

    def __init__(self) -> None:
        self.client: OpenAI | None = None
        self._provider = "groq"
        self._api_key = ""
        self._model = ""
        self._base_url = ""
        self._connect_from_config()

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def _connect_from_config(self) -> None:
        """Read the active LLM profile from ConfigManager and connect."""
        cfg = ConfigManager()
        profile = cfg.get_active_profile()

        provider = profile.get("provider", "groq")
        api_key = profile.get("api_key", "") or ""
        model = profile.get("model", "") or ""
        base_url = profile.get("base_url", "") or ""

        # Env-var fallback for Groq (honours existing .env / GROQ_API_KEY)
        if provider == "groq" and not api_key:
            api_key = os.getenv("GROQ_API_KEY") or os.getenv("GROQ_KEY") or ""

        # Env-var fallback for OpenAI (honours existing .env / OPENAI_API_KEY)
        if provider == "openai" and not api_key:
            api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY") or ""

        self._connect(provider, api_key, model, base_url)

    def configure(self, provider: str, api_key: str, model: str = "", base_url: str = "") -> None:
        """Reconfigure the service at runtime (e.g. after Settings save)."""
        self._connect(provider, api_key, model, base_url)

    @staticmethod
    def _normalise_provider(provider: str) -> str:
        """Match the provider key case-insensitively against PROVIDERS."""
        if not provider:
            return "custom"
        lower = provider.lower().strip()
        for key in PROVIDERS:
            if key.lower() == lower:
                return key
        return "custom"

    @staticmethod
    def _normalise_base_url(url: str) -> str:
        """Strip a trailing /chat/completions so the OpenAI SDK can append it."""
        if not url:
            return ""
        url = url.strip().rstrip("/")
        for suffix in ("/chat/completions", "/chat/completions/"):
            if url.endswith(suffix):
                url = url[: -len(suffix)].rstrip("/")
                break
        return url

    @staticmethod
    def _is_placeholder_key(key: str) -> bool:
        """Detect unfilled secret references that are clearly placeholders.

        Catches the common template/secret-manager formats people accidentally
        paste into config files:

        - ``${VAR}``            shell / docker-compose style
        - ``${input:VAR}``     GitHub Actions / 1Password CLI style
        - ``{{ secrets.X }}``  GitHub Actions Jinja style
        - ``<YOUR_KEY_HERE>``  README placeholders
        - ``xxxxxx…``           redaction artifacts

        A real Groq key starts with ``gsk_``; a real OpenAI key with ``sk-``.
        We only treat a string as a placeholder when it matches one of the
        explicit patterns above — never a blanket length check, so a
        legitimately short key isn't rejected.
        """
        if not key:
            return False
        # Strip surrounding whitespace once; comparison happens case-sensitively
        # because all the placeholder formats are themselves case-sensitive.
        candidate = key.strip()
        if not candidate:
            return True
        # Shell-style / GitHub Actions / 1Password: ${...} or ${input:...}
        if candidate.startswith("${") and candidate.endswith("}"):
            return True
        # GitHub Actions Jinja / template rendering: {{ ... }}
        if candidate.startswith("{{") and candidate.endswith("}}"):
            return True
        # README placeholders: <…>, <your-…-here>
        if candidate.startswith("<") and candidate.endswith(">"):
            lower = candidate.lower()
            if "your" in lower or "key" in lower or "token" in lower or "api" in lower:
                return True
        # Redaction artifact: 'xxxxxx' or 'XXXXXXXX' of any length >= 2
        # (single 'x' is too short to be a useful redaction marker)
        return bool(re.fullmatch(r"x{2,}", candidate, flags=re.IGNORECASE))

    def _connect(self, provider: str, api_key: str, model: str, base_url: str) -> None:
        provider = self._normalise_provider(provider)
        base_url = self._normalise_base_url(base_url)
        preset = PROVIDERS.get(provider, PROVIDERS["custom"])

        self._provider = provider
        self._api_key = api_key
        self._model = model or preset["default_model"]
        self._base_url = base_url or preset["base_url"]

        requires_key = preset["requires_key"]
        if requires_key and self._is_placeholder_key(self._api_key):
            self.client = None
            return
        if requires_key and not self._api_key:
            self.client = None
            return

        if not self._base_url:
            self.client = None
            return

        try:
            self.client = OpenAI(
                api_key=self._api_key or "not-needed",
                base_url=self._base_url,
            )
            logger.info(
                "LLM client initialized: provider=%s, model=%s, base_url=%s",
                provider,
                self._model,
                self._base_url,
            )
        except Exception as e:
            logger.error("Failed to initialize OpenAI client for provider %s: %s", provider, e)
            self.client = None

    @property
    def model_name(self) -> str:
        return self._model

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _chat(self, prompt: str, system: str | None = None) -> str:
        """Send a single-turn chat message and return the response text.

        ``prompt`` is always sent as the user message. ``system``, if given,
        is sent as a system message — this is the right place for
        language / role instructions, because models tend to *echo* a
        system-style instruction when it appears inside the user message.
        """
        if not self.client:
            logger.warning("Attempted LLM completion but client is not configured")
            return _NOT_CONFIGURED_MSG
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        logger.info(
            "Sending LLM completion request: model=%s, prompt_len=%d", self._model, len(prompt)
        )
        try:
            completion = self.client.chat.completions.create(
                model=self._model,
                messages=messages,
            )
            text = completion.choices[0].message.content
            logger.info(
                "Received LLM completion response (%d chars)", len(text.strip()) if text else 0
            )
            return text.strip() if text else _NO_RESPONSE_MSG
        except Exception as exc:
            exc_type = type(exc).__name__
            logger.error("LLM completion failed [%s]: %s", exc_type, exc)
            return f"Error [{exc_type}]: Anfrage an das LLM fehlgeschlagen – {exc}"

    @staticmethod
    def _lang_instruction() -> str:
        """Return the language instruction for the system message.

        We send it as a separate system message (not as a suffix on the
        user prompt) because reasoning models tend to *echo* the
        instruction at the top of the answer when it appears inside the
        user message.
        """
        return _LANGUAGE_INSTRUCTION

    @staticmethod
    def _section_labels() -> dict[str, str]:
        """Return the (German) section labels the summary must use verbatim."""
        return _SECTION_LABELS

    # ------------------------------------------------------------------
    # Public prompts
    # ------------------------------------------------------------------

    def generate_summary(self, pgn_text: str, analysis_summary: str, time_stats: str = "") -> str:
        """Generate a chess-expert narrative summary for a single game."""
        if not self.client:
            return _NOT_CONFIGURED_MSG

        if len(pgn_text) > 10_000:
            pgn_text = pgn_text[:10_000] + "… (truncated)"

        time_block = ""
        if time_stats:
            time_block = (
                "\nClock data (per move):\n"
                f"{time_stats}\n\n"
                "When relevant, comment on time pressure, very fast blunders, "
                "or long thinks that paid off.\n"
            )

        labels = self._section_labels()
        game_comment_lbl = labels["game_comment"]
        summary_lbl = labels["summary"]

        prompt = (
            "You are a chess expert. Analyze the following chess game and the provided "
            "analysis summary.\n\n"
            f"First, provide a short '{game_comment_lbl}' (e.g. Sharp, Tactical, "
            "Brilliant, Chaotic, Positional Masterpiece …) that captures the essence "
            "of the game.\n"
            f"Then provide a concise, insightful '{summary_lbl}' (max 200 words). "
            "Highlight key turning points, brilliant moves, and major mistakes."
            + time_block
            + "\n\nReply with EXACTLY this structure and nothing else — "
            "do not include any other section headers, do not echo the input "
            "labels, do not add a preamble or closing remark:\n\n"
            f"{game_comment_lbl}: <one short phrase>\n\n"
            f"{summary_lbl}:\n<the summary in prose>\n\n"
            "---\n"
            "INPUT — do not repeat any of this in your reply:\n\n"
            f"Analysis Summary:\n{analysis_summary}\n\n"
            f"PGN:\n{pgn_text}"
        )
        return self._chat(prompt, system=self._lang_instruction())

    def generate_coach_insights(self, stats_text: str) -> str:
        """Generate structured coaching diagnostics from player performance dossier."""
        if not self.client:
            return _NOT_CONFIGURED_MSG

        prompt = (
            "You are an insightful, direct, and constructive chess coach analyzing a student's performance dossier.\n\n"
            f"{stats_text}\n\n"
            "Provide a rigorous, actionable coaching diagnostic divided into EXACTLY these 3 sections with these German markdown headers, written verbatim:\n\n"
            "### Stärken & Superkräfte\n"
            "- **Titel**: 1-2 concise sentences highlighting a specific proven strength (e.g. tactical vision, endgame technique, or opening preparation).\n"
            "- **Titel**: 1-2 concise sentences highlighting another proven strength.\n\n"
            "### Kritische Schwächen & blinde Flecken\n"
            "- **Titel**: 1-2 concise sentences diagnosing the primary rating leak (e.g. hanging pieces, moving too fast in Rapid/Classical, squandered winning leads, or endgame collapses).\n"
            "- **Titel**: 1-2 concise sentences identifying another recurring mistake pattern.\n\n"
            "### Dein persönlicher Trainingsplan\n"
            "- **Maßnahme**: Concrete practice routine addressing the primary leak (e.g. specific puzzle themes, clock pacing rules, or opening repertoire repairs).\n"
            "- **Maßnahme**: Concrete practice routine addressing the secondary leak.\n\n"
            "Critical Guidelines:\n"
            "- TIME MANAGEMENT RULE: NEVER praise fast move times in Rapid or Classical games as a strength! "
            "If the student moves in under 8 seconds per move in Rapid/Classical and leaves excess time on their clock while blundering, "
            "classify this as a CRITICAL LEAK ('Zu schnell gespielt / Blitzen im Schnellschach'). Instruct them to slow down and calculate.\n"
            "- Rely strictly on the data provided in the dossier.\n"
            "- Do NOT use emojis.\n"
            "- Keep the tone professional, direct, analytical, and encouraging.\n"
            "- Address the student directly and informally in German (du-Form).\n"
            "- Do NOT include conversational pleasantries, introductory greetings, or sign-offs."
        )
        return self._chat(prompt, system=self._lang_instruction())
