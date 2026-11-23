// The short password prompt shared by the dashboard and the video studio.
import { useEffect, useRef, useState } from "preact/hooks";

import { adminLogin } from "../../app/adminApi";
import { t } from "../../i18n";

export function AdminLogin({ onDone, hint }: { onDone: () => void; hint?: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const r = await adminLogin(password);
    setBusy(false);
    if (r.ok) return onDone();
    setPassword("");
    input.current?.focus();
    if (r.reason === "wrong") setError(t("Falsches Passwort."));
    else if (r.reason === "locked") setError(t("Zu viele Versuche. Bitte in {min} Minuten erneut versuchen.", { min: Math.max(1, Math.ceil((r.retryAfter ?? 900) / 60)) }));
    else if (r.reason === "unconfigured") setError(t("Der Admin-Zugang ist auf dem Server noch nicht eingerichtet."));
    else setError(t("Keine Verbindung zum Server."));
  };

  return (
    <form class="admin-login" onSubmit={submit}>
      {hint && <p class="small muted" style={{ margin: "0 0 10px" }}>{hint}</p>}
      {/* Hidden user name so password managers can store the password: next time one tap. */}
      <input type="text" name="username" value="admin" autocomplete="username" hidden readOnly />
      <div class="row">
        <input
          ref={input}
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder={t("Admin-Passwort")}
          aria-label={t("Admin-Passwort")}
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <button class="btn primary" type="submit" disabled={busy || !password}>
          {busy ? t("Prüfe …") : t("Entsperren")}
        </button>
      </div>
      {error && <p class="small error" role="alert" style={{ margin: "8px 0 0" }}>{error}</p>}
    </form>
  );
}
