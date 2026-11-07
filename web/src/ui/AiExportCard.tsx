// Settings card for the AI export: one Markdown file to upload into ChatGPT,
// Claude, Gemini or any other chat model, plus the message to send with it.
import { useState } from "preact/hooks";

import { exportForAi } from "../app/exporter";
import { AI_EXPORT_LIMITS, AI_EXPORT_PROMPT, type AiExportDetail } from "../domain/aiExport";
import { PeriodSelect } from "./useProfile";

const DETAIL_HINT: Record<AiExportDetail, string> = {
  full: "für ChatGPT, Claude, Gemini (bezahlt oder aktuell)",
  compact: "für kostenlose Versionen und lokale Modelle",
};

export function AiExportCard() {
  const [period, setPeriod] = useState("All Time");
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
        setMsg({ text: "Keine eigenen Partien im Zeitraum. Prüfe deine Benutzernamen unten oder wähle einen längeren Zeitraum.", error: true });
      } else if (!r.analyzed) {
        setMsg({ text: `Datei mit ${r.games} Partien erstellt. Noch keine davon ist analysiert, die KI sieht daher nur Ergebnisse und Eröffnungen, keine Fehler.` });
      } else {
        setMsg({ text: `Datei mit ${r.games} Partien erstellt, ${r.analyzed} davon mit Engine-Analyse.` });
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
      .catch(() => setMsg({ text: `Kopieren nicht möglich. Schreibe der KI: „${AI_EXPORT_PROMPT}“` }));
  };

  return (
    <div class="card" id="ki-export">
      <h3>Für KI exportieren</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        Eine Textdatei mit allem, was eine KI für eine ausführliche Analyse deines Schachs braucht: den Auftrag mit der
        gewünschten Gliederung, eine Legende zu allen Werten, deine Statistiken, Fähigkeiten, Stärken, Schwächen und
        Eröffnungen sowie die teuersten Züge deiner Partien mit Stellung, besserem Zug und konkreter Begründung.
      </p>
      <div class="filters">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <div class="segmented" role="radiogroup" aria-label="Umfang" style={{ marginBottom: "6px" }}>
        {(Object.keys(AI_EXPORT_LIMITS) as AiExportDetail[]).map((k) => (
          <button key={k} role="radio" aria-checked={detail === k} class={detail === k ? "active" : ""} onClick={() => setDetail(k)}>
            {AI_EXPORT_LIMITS[k].label}
          </button>
        ))}
      </div>
      <p class="small faint" style={{ margin: "0 0 12px" }}>
        {AI_EXPORT_LIMITS[detail].label} {DETAIL_HINT[detail]}: kritische Momente der neuesten {AI_EXPORT_LIMITS[detail].moments}{" "}
        analysierten Partien, {AI_EXPORT_LIMITS[detail].annotated} davon Zug für Zug kommentiert.
      </p>
      <div class="row">
        <button class="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Wird erstellt …" : "KI-Datei herunterladen"}
        </button>
        <button class="btn" onClick={copy}>
          {copied ? "Kopiert ✓" : "Nachricht für die KI kopieren"}
        </button>
      </div>
      <ol class="small muted" style={{ margin: "12px 0 0", paddingLeft: "20px", lineHeight: 1.6 }}>
        <li>KI-Datei herunterladen (endet auf .md, ist normaler Text).</li>
        <li>In ChatGPT, Claude oder Gemini über die Büroklammer bzw. das Plus hochladen.</li>
        <li>Die kopierte Nachricht dazuschreiben und abschicken.</li>
      </ol>
      {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
    </div>
  );
}
