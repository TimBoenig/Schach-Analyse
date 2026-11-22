// Where the data goes, as a small switch instead of a wall of text: without an
// account everything stays on the device; with one, the analyses are copied to
// a server in Frankfurt so other devices see them. Every line here matches the
// privacy notice (LegalView); change both together.
import { useState } from "preact/hooks";

import { IconCloud, IconCpu, IconShield } from "../icons";

type Mode = "local" | "account";

const NEVER = ["Kein Passwort von chess.com oder Lichess", "Keine Werbung, kein Tracking, keine Cookies", "Keine Analyse-Dienste, die mitlesen"];

export function Privacy() {
  const [mode, setMode] = useState<Mode>("local");
  const account = mode === "account";
  return (
    <div class={`ld-priv ${mode}`}>
      <div class="ld-priv-switch" role="radiogroup" aria-label="Mit oder ohne Konto">
        <button role="radio" aria-checked={!account} class={!account ? "on" : ""} onClick={() => setMode("local")}>
          Ohne Konto
        </button>
        <button role="radio" aria-checked={account} class={account ? "on" : ""} onClick={() => setMode("account")}>
          Mit Konto
        </button>
      </div>

      <div class="ld-priv-map" aria-hidden="true">
        <div class="ld-priv-node src">
          <b>chess.com, Lichess</b>
          <span>deine öffentlichen Partien</span>
        </div>
        <span class="ld-priv-wire in" />
        <div class="ld-priv-node me">
          <IconCpu />
          <b>Dein Gerät</b>
          <span>Engine, Statistik, Training</span>
        </div>
        <span class={`ld-priv-wire out${account ? " live" : ""}`} />
        <div class={`ld-priv-node cloud${account ? " live" : ""}`}>
          <IconCloud />
          <b>{account ? "Server in Frankfurt" : "Unser Server"}</b>
          <span>{account ? "Kopie deiner Analysen für deine Geräte" : "bekommt nichts"}</span>
        </div>
      </div>

      <p class="ld-priv-says" aria-live="polite">
        {account
          ? "Mit Konto speichern wir deine E-Mail-Adresse und eine Kopie deiner Partien und Analysen in Frankfurt, verschlüsselt übertragen, damit du sie auf Handy und PC hast. Löschen kannst du alles jederzeit selbst, sofort."
          : "Ohne Konto verlässt nichts dein Gerät außer dem Abruf deiner Partien bei chess.com oder Lichess. Die Engine rechnet in deinem Browser, auch offline."}
      </p>

      <ul class="ld-priv-never">
        {NEVER.map((n) => (
          <li key={n}>
            <IconShield />
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}
