import { useEffect, useMemo, useState } from "preact/hooks";

import {
  AUTO_ANALYZE_KEY,
  currentPerf,
  deviceInfo,
  loadDepthChoice,
  loadPerfChoice,
  loadSpeedLog,
  setDepthChoice,
  setPerfChoice,
} from "../app/analysisService";
import {
  CUSTOM_LIMITS,
  DEPTH_PRESETS,
  durationDe,
  estimateGame,
  EXCLUDE_BULLET_KEY,
  isBulletGame,
  normalizeChoice,
  PRESET_ORDER,
  resolveSettings,
  settingsLabel,
  SKIP_BULLET_KEY,
  type DepthChoice,
  type DepthScope,
} from "../domain/analysisDepth";
import { getUserColor } from "../domain/metrics";
import {
  HASH_OPTIONS,
  maxEnginesFor,
  PERF_ORDER,
  PERF_PRESETS,
  perfLabel,
  resolvePerf,
  usableCores,
  type PerfChoice,
  type PerfSettings,
} from "../domain/performance";
import { getSetting, listGames, setSetting } from "../storage/db";
import { useBulletPrefs } from "./useAnalysisPrefs";

const SCOPES: Array<[DepthScope, string]> = [
  ["own", "Meine Partien"],
  ["friends", "Freunde & Gegner"],
];

const SCOPE_TEXT: Record<DepthScope, string> = {
  own: "Für deine eigenen Partien. Hier lohnt sich Genauigkeit, denn daraus entstehen dein Profil und deine Übungen.",
  friends:
    "Für Partien von Freunden und anderen Spielern. Für den Vergleich zählen viele Partien mehr als jede Nachkommastelle, deshalb reicht meist „Schnell“.",
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function DepthPicker({ scope, engines }: { scope: DepthScope; engines: number }) {
  const [choice, setChoice] = useState<DepthChoice | null>(null);
  const speedLog = useMemo(loadSpeedLog, [scope]);

  useEffect(() => {
    setChoice(null);
    void loadDepthChoice(scope).then(setChoice);
  }, [scope]);

  if (!choice) return <div class="skeleton" style={{ height: "150px" }} />;

  const save = (c: DepthChoice) => {
    const n = normalizeChoice(c, scope);
    setChoice(n);
    // Also reaches a game in analysis right now, from its next position on.
    void setDepthChoice(scope, n);
  };
  const settings = resolveSettings(choice);
  const est = estimateGame(settings, speedLog, engines);
  // Position of the choice between quickest and most thorough, for the meter.
  const level = Math.min(1, Math.max(0, (settings.depth - CUSTOM_LIMITS.depthMin) / (CUSTOM_LIMITS.depthMax - CUSTOM_LIMITS.depthMin)));

  return (
    <>
      <p class="muted small" style={{ margin: "10px 0" }}>
        {SCOPE_TEXT[scope]}
      </p>
      <div class="depth-grid" role="radiogroup" aria-label="Analysetiefe">
        {PRESET_ORDER.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={choice.preset === p}
            class={choice.preset === p ? "active" : ""}
            onClick={() => save({ preset: p })}
          >
            <strong>{DEPTH_PRESETS[p].name}</strong>
            <small>Tiefe {DEPTH_PRESETS[p].settings.depth}</small>
          </button>
        ))}
        <button
          role="radio"
          aria-checked={choice.preset === "custom"}
          class={choice.preset === "custom" ? "active" : ""}
          onClick={() => save({ preset: "custom", depth: settings.depth, seconds: settings.movetimeMs / 1000 })}
        >
          <strong>Eigene</strong>
          <small>selbst einstellen</small>
        </button>
      </div>

      {choice.preset === "custom" && (
        <div class="depth-custom">
          <label class="range-field">
            <span>
              Tiefe <strong class="tnum">{choice.depth}</strong>
            </span>
            <input
              type="range"
              min={CUSTOM_LIMITS.depthMin}
              max={CUSTOM_LIMITS.depthMax}
              step={1}
              value={choice.depth}
              onInput={(e) => setChoice({ ...choice, depth: Number(e.currentTarget.value) })}
              onChange={(e) => save({ ...choice, depth: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="range-field">
            <span>
              Höchstens <strong class="tnum">{String(choice.seconds).replace(".", ",")} s</strong> pro Zug
            </span>
            <input
              type="range"
              min={CUSTOM_LIMITS.secondsMin}
              max={CUSTOM_LIMITS.secondsMax}
              step={0.1}
              value={choice.seconds}
              onInput={(e) => setChoice({ ...choice, seconds: Number(e.currentTarget.value) })}
              onChange={(e) => save({ ...choice, seconds: Number(e.currentTarget.value) })}
            />
          </label>
          <p class="faint small" style={{ margin: 0 }}>
            Stockfish hört auf, sobald die Tiefe erreicht oder die Zeit um ist. Auf Handys ist meist die Zeit die Grenze.
          </p>
        </div>
      )}

      <div class="depth-meter" aria-hidden="true">
        <span class="small faint">schneller</span>
        <div class="depth-meter-track">
          <div style={{ left: `${level * 100}%` }} />
        </div>
        <span class="small faint">genauer</span>
      </div>
      <p class="small depth-estimate">
        <strong>{choice.preset === "custom" ? "Eigene" : DEPTH_PRESETS[choice.preset].name}</strong> · {settingsLabel(settings)}
        <br />
        <span class="muted">
          {est.measured
            ? `Eine Partie mit 40 Zügen dauert auf diesem Gerät etwa ${durationDe(est.seconds)}.`
            : `Eine Partie mit 40 Zügen dauert höchstens etwa ${durationDe(est.seconds)}. Nach der ersten Analyse siehst du hier, wie schnell dieses Gerät ist.`}{" "}
          Änderungen gelten sofort, auch für eine Partie, die gerade analysiert wird.
        </span>
      </p>
    </>
  );
}

/** Engines in parallel and hash: stored on this device only, applied at once. */
function PerformancePicker({ onChange }: { onChange: (p: PerfSettings) => void }) {
  const device = useMemo(deviceInfo, []);
  const [choice, setChoice] = useState<PerfChoice>(loadPerfChoice);
  const perf = resolvePerf(choice, device);
  const cores = usableCores(device);
  const save = (c: PerfChoice) => {
    setChoice(c);
    onChange(setPerfChoice(c));
  };
  const custom = choice.preset === "custom" ? choice : null;

  return (
    <>
      <p class="muted small" style={{ margin: "6px 0 10px" }}>
        Wie viel Rechenleistung die Analyse nutzen darf. Mehr Engines rechnen gleichzeitig an verschiedenen Zügen, so wird
        jede Partie schneller fertig und du kannst eine größere Tiefe wählen. Gilt nur für dieses Gerät. Dein Gerät hat{" "}
        <strong>{cores} Kerne</strong>.
      </p>
      <div class="depth-grid perf-grid" role="radiogroup" aria-label="Leistung">
        {PERF_ORDER.map((p) => {
          const r = resolvePerf({ preset: p }, device);
          return (
            <button key={p} role="radio" aria-checked={choice.preset === p} class={choice.preset === p ? "active" : ""} onClick={() => save({ preset: p })}>
              <strong>{PERF_PRESETS[p].name}</strong>
              <small>
                {r.engines} {r.engines === 1 ? "Engine" : "Engines"}
              </small>
            </button>
          );
        })}
        <button
          role="radio"
          aria-checked={choice.preset === "custom"}
          class={choice.preset === "custom" ? "active" : ""}
          onClick={() => save({ preset: "custom", engines: perf.engines, hashMb: perf.hashMb })}
        >
          <strong>Eigene</strong>
          <small>selbst einstellen</small>
        </button>
      </div>
      {custom && (
        <div class="depth-custom">
          <label class="range-field">
            <span>
              Engines gleichzeitig <strong class="tnum">{custom.engines}</strong>
              <span class="faint"> von {maxEnginesFor(device)}</span>
            </span>
            <input
              type="range"
              min={1}
              max={maxEnginesFor(device)}
              step={1}
              value={custom.engines}
              onInput={(e) => setChoice({ ...custom, engines: Number(e.currentTarget.value) })}
              onChange={(e) => save({ ...custom, engines: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="range-field">
            <span>Hash je Engine</span>
            <select value={custom.hashMb} onChange={(e) => save({ ...custom, hashMb: Number(e.currentTarget.value) })}>
              {HASH_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h} MB
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p class="small depth-estimate">
        <strong>{custom ? "Eigene" : PERF_PRESETS[choice.preset as keyof typeof PERF_PRESETS].name}</strong> · {perfLabel(perf)}
        <br />
        <span class="muted">
          {perf.engines >= cores
            ? "Alle Kerne sind belegt: der PC kann laut und warm werden, andere Programme werden langsamer."
            : perf.engines > 1
              ? `Belegt etwa ${Math.round((perf.engines / cores) * 100)} % der Rechenleistung, solange analysiert wird.`
              : "Schont Akku und Lüfter. Gut für Handy und Tablet."}
          {device.mobile && perf.engines > 2 ? " Auf Handy und Tablet wird das Gerät dabei schnell heiß." : ""}
        </span>
      </p>
    </>
  );
}

function BulletStats() {
  const [counts, setCounts] = useState<{ bullet: number; total: number } | null>(null);
  useEffect(() => {
    void (async () => {
      const names = await getSetting<string[]>("usernames", []);
      const mine = (await listGames()).filter((g) => getUserColor(g, names));
      setCounts({ bullet: mine.filter(isBulletGame).length, total: mine.length });
    })();
  }, []);
  if (!counts || !counts.total) return null;
  return (
    <p class="small muted" style={{ margin: "6px 0 0" }}>
      {counts.bullet
        ? `${counts.bullet} von ${counts.total} deiner Partien sind Bullet (${pct(counts.bullet, counts.total)} %).`
        : "Du hast bisher keine Bullet-Partien."}
    </p>
  );
}

/** Settings card: analysis depth for own games and for friends, Bullet rules, auto-analysis. */
export function AnalysisSettingsCard() {
  const [scope, setScope] = useState<DepthScope>("own");
  const [auto, setAuto] = useState(true);
  const [perf, setPerf] = useState(currentPerf);
  const bullet = useBulletPrefs();

  useEffect(() => {
    void getSetting<boolean>(AUTO_ANALYZE_KEY, true).then(setAuto);
  }, []);

  return (
    <div class="card">
      <h3>Analyse</h3>
      <div class="segmented full" role="tablist" aria-label="Für welche Partien">
        {SCOPES.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={scope === k} class={scope === k ? "active" : ""} onClick={() => setScope(k)}>
            {label}
          </button>
        ))}
      </div>
      <DepthPicker scope={scope} engines={perf.engines} />

      <h4 style={{ margin: "18px 0 0" }}>Leistung</h4>
      <PerformancePicker onChange={setPerf} />

      <h4 style={{ margin: "18px 0 0" }}>Bullet</h4>
      <BulletStats />
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={bullet.excludeBullet}
          onChange={(e) => void setSetting(EXCLUDE_BULLET_KEY, e.currentTarget.checked)}
        />
        <span>
          <strong>Bullet aus den Statistiken lassen</strong>
          <small class="faint">
            Start, alle Statistik-Seiten, Spieler und Training zählen Bullet nicht mit. Mit dem Filter
            „Bullet“ kannst du sie trotzdem ansehen.
          </small>
        </span>
      </label>
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={bullet.skipBullet}
          onChange={(e) => void setSetting(SKIP_BULLET_KEY, e.currentTarget.checked)}
        />
        <span>
          <strong>Bullet-Partien nicht analysieren</strong>
          <small class="faint">
            Spart Zeit und Akku: „Alle analysieren“ und die automatische Analyse überspringen Bullet. Eine einzelne Partie
            kannst du weiter von Hand analysieren.
          </small>
        </span>
      </label>

      <h4 style={{ margin: "18px 0 0" }}>Automatik</h4>
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.currentTarget.checked);
            void setSetting(AUTO_ANALYZE_KEY, e.currentTarget.checked);
          }}
        />
        <span>
          <strong>Importierte Partien automatisch analysieren</strong>
          <small class="faint">Neue Partien kommen direkt in die Warteschlange, die neuesten zuerst.</small>
        </span>
      </label>
    </div>
  );
}
