// Settings card for the AI export: one Markdown file to upload into ChatGPT,
// Claude, Gemini or any other chat model, plus the message to send with it.
import { useState } from "preact/hooks";

import { exportForAi } from "../app/exporter";
import { AI_EXPORT_LIMITS, AI_EXPORT_PROMPT, type AiExportDetail } from "../domain/aiExport";
import { PAGE_PERIODS } from "../domain/periods";
import { PeriodSelect } from "./useProfile";
import { t } from "../i18n";

const DETAIL_HINT: Record<AiExportDetail, string> = {
  full: t("für ChatGPT, Claude, Gemini (bezahlt oder aktuell)"),
  compact: t("für kostenlose Versionen und lokale Modelle"),
};

export function AiExportCard() {
  // The last 90 days fit a chat window and describe how the player plays now.
  const [period, setPeriod] = useState(PAGE_PERIODS.aiExport);
  const [detail, setDetail] = useState<AiExportDetail>("full");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await exportForAi(period, detail);
      if (!r.games) {
        setMsg({ text: t("Keine eigenen Partien im Zeitraum. Prüfe deine Benutzernamen unten oder wähle einen längeren Zeitraum."), error: true });
      } else if (!r.analyzed) {
        setMsg({ text: t("Datei mit {games} Partien erstellt. Noch keine davon ist analysiert, die KI sieht daher nur Ergebnisse und Eröffnungen, keine Fehler.", { games: r.games }) });
      } else {
        setMsg({ text: t("Datei mit {games} Partien erstellt, {analyzed} davon mit Engine-Analyse.", { games: r.games, analyzed: r.analyzed }) });
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard
      ?.writeText(AI_EXPORT_PROMPT)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => setMsg({ text: t("Kopieren nicht möglich. Schreibe der KI: „{AI_EXPORT_PROMPT}“", { AI_EXPORT_PROMPT }) }));
  };

  return (
    <div class="card settings-card" id="ki-export">
      <h3>{t("Für KI exportieren")}</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        
        {t("Eine Textdatei mit allem, was eine KI für eine ausführliche Analyse deines Schachs braucht: den Auftrag mit der gewünschten Gliederung, eine Legende zu allen Werten, deine Statistiken, Fähigkeiten, Stärken, Schwächen und Eröffnungen sowie die teuersten Züge deiner Partien mit Stellung, besserem Zug und konkreter Begründung.")}
      </p>
      <div class="filters">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <div class="segmented" role="radiogroup" aria-label={t("Umfang")} style={{ marginBottom: "6px" }}>
        {(Object.keys(AI_EXPORT_LIMITS) as AiExportDetail[]).map((k) => (
          <button key={k} role="radio" aria-checked={detail === k} class={detail === k ? "active" : ""} onClick={() => setDetail(k)}>
            {AI_EXPORT_LIMITS[k].label}
          </button>
        ))}
      </div>
      <p class="small faint" style={{ margin: "0 0 12px" }}>
        {t("{label} {n}: kritische Momente der neuesten {moments} analysierten Partien, {annotated} davon Zug für Zug kommentiert.", { label: AI_EXPORT_LIMITS[detail].label, n: DETAIL_HINT[detail], moments: AI_EXPORT_LIMITS[detail].moments, annotated: AI_EXPORT_LIMITS[detail].annotated })}
      </p>
      <div class="row">
        <button class="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? t("Wird erstellt …") : t("KI-Datei herunterladen")}
        </button>
        <button class="btn" onClick={copy}>
          {copied ? t("Kopiert ✓") : t("Nachricht für die KI kopieren")}
        </button>
      </div>
      <ol class="small muted" style={{ margin: "12px 0 0", paddingLeft: "20px", lineHeight: 1.6 }}>
        <li>{t("KI-Datei herunterladen (endet auf .md, ist normaler Text).")}</li>
        <li>{t("In ChatGPT, Claude oder Gemini über die Büroklammer bzw. das Plus hochladen.")}</li>
        <li>{t("Die kopierte Nachricht dazuschreiben und abschicken.")}</li>
      </ol>
      {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
    </div>
  );
}
