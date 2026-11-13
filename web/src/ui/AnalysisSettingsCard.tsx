import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  AUTO_ANALYZE_KEY,
  BACKGROUND_KEYS,
  backgroundAnalyze,
  subscribeQueue,
  type QueueState,
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
import { IconBolt, IconCpu, IconGauge, IconTimer } from "./icons";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { ENGINE_NAME } from "../engine/info";

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
            {ENGINE_NAME} hört auf, sobald die Tiefe erreicht oder die Zeit um ist. Auf Handys ist meist die Zeit die Grenze.
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

/** Card head for settings: icon chip, title and one line on what the card is for. */
export function SettingsHead({ icon, title, sub }: { icon: ComponentChildren; title: string; sub?: string }) {
  return (
    <div class="settings-head">
      <span class="settings-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        {sub && <p class="small muted">{sub}</p>}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: ComponentChildren }) {
  return (
    <label class="toggle-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>
        <strong>{title}</strong>
        <small class="faint">{children}</small>
      </span>
    </label>
  );
}

function useBoolSetting(key: string, fallback: boolean): [boolean, (v: boolean) => Promise<void>] {
  const [v, setV] = useState(fallback);
  useEffect(() => void getSetting<boolean>(key, fallback).then(setV), [key]);
  return [
    v,
    async (next: boolean) => {
      setV(next);
      await setSetting(key, next);
    },
  ];
}

function AutomationCard() {
  const [auto, setAuto] = useBoolSetting(AUTO_ANALYZE_KEY, true);
  const [own, setOwn] = useBoolSetting(BACKGROUND_KEYS.own, false);
  const [friends, setFriends] = useBoolSetting(BACKGROUND_KEYS.friends, false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => subscribeQueue(setQueue), []);
  // Turning a switch on starts at once instead of waiting for the next app start.
  const turn = (set: (v: boolean) => Promise<void>) => (v: boolean) =>
    void set(v).then(() => (v ? backgroundAnalyze().then(setAdded) : undefined));
  const waiting = (queue?.queued.length ?? 0) + (queue?.current ? 1 : 0);
  return (
    <div class="card settings-card">
      <SettingsHead icon={<IconBolt />} title="Automatik" sub="Was beim Öffnen und nach dem Import von selbst analysiert wird." />
      <Toggle checked={own} onChange={turn(setOwn)} title="Eigene Partien beim Öffnen analysieren">
        Beim Start der Seite kommen alle noch nicht analysierten eigenen Partien in die Warteschlange, die neuesten zuerst.
      </Toggle>
      <Toggle checked={friends} onChange={turn(setFriends)} title="Partien von Freunden beim Öffnen analysieren">
        Genauso für deine Freunde (oder alle Spieler, wenn niemand als Freund markiert ist), mit der Tiefe für Freunde.
      </Toggle>
      <Toggle checked={auto} onChange={(v) => void setAuto(v)} title="Importierte Partien sofort analysieren">
        Neu geladene Partien kommen direkt in die Warteschlange.
      </Toggle>
      <p class="small settings-status">
        <span class={`dot${waiting ? " on" : ""}`} />
        {waiting
          ? `Im Hintergrund: ${waiting} ${waiting === 1 ? "Partie wartet" : "Partien warten"} auf die Analyse.`
          : "Gerade läuft keine Analyse."}
        {added !== null && <span class="muted"> {added ? `${added} neu eingereiht.` : "Alles schon analysiert."}</span>}
      </p>
    </div>
  );
}

/** Analysis settings as separate cards: automation, depth (own vs friends), performance, Bullet. */
export function AnalysisSettingsCards() {
  const [scope, setScope] = useState<DepthScope>("own");
  const [perf, setPerf] = useState(currentPerf);
  const bullet = useBulletPrefs();

  return (
    <>
      <AutomationCard />
      <div class="card settings-card">
        <SettingsHead icon={<IconGauge />} title="Analysetiefe" sub={`Wie gründlich ${ENGINE_NAME} jede Stellung prüft.`} />
        <div class="segmented full" role="tablist" aria-label="Für welche Partien">
          {SCOPES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={scope === k} class={scope === k ? "active" : ""} onClick={() => setScope(k)}>
              {label}
            </button>
          ))}
        </div>
        <DepthPicker scope={scope} engines={perf.engines} />
      </div>
      <div class="card settings-card">
        <SettingsHead icon={<IconCpu />} title="Leistung" sub="Wie viel von diesem Gerät die Analyse nutzen darf. Gilt nur hier." />
        <PerformancePicker onChange={setPerf} />
      </div>
      <div class="card settings-card">
        <SettingsHead icon={<IconTimer />} title="Bullet" sub="Sehr schnelle Partien verzerren oft die Statistik." />
        <BulletStats />
        <Toggle
          checked={bullet.excludeBullet}
          onChange={(v) => void setSetting(EXCLUDE_BULLET_KEY, v)}
          title="Bullet aus den Statistiken lassen"
        >
          Start, alle Statistik-Seiten, Spieler und Training zählen Bullet nicht mit. Mit dem Filter „Bullet“ kannst du sie
          trotzdem ansehen.
        </Toggle>
        <Toggle checked={bullet.skipBullet} onChange={(v) => void setSetting(SKIP_BULLET_KEY, v)} title="Bullet-Partien nicht analysieren">
          Spart Zeit und Akku: „Alle analysieren“ und jede Automatik überspringen Bullet. Eine einzelne Partie kannst du
          weiter von Hand analysieren.
        </Toggle>
      </div>
    </>
  );
}
