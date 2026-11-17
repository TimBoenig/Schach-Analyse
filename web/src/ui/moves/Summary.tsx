// "Züge & Fehler", the card on top: one sentence, every move as one bar and
// the four figures that sum the tally up.
import { KIND_GROUPS, type MoveTally, sumOf, TALLY_CLASSES, tallySummary } from "../../domain/profile";
import { IconChevron } from "../icons";
import { CountUp } from "../kit";
import { CLASS_COLOR, classLabel } from "../labels";
import { SplitBar, Stat } from "../viz/Bars";
import { de, plural } from "./shared";

/** Lucena's one sentence on the tally. */
function lead(t: MoveTally, topPct: number): string {
  const b = t.counts.Brilliant;
  const g = t.counts.Great;
  if (b) return `${plural(b, "brillanter Zug", "brillante Züge")} und ${plural(g, "großartiger", "großartige")} in ${plural(t.games, "Partie", "Partien")}. Sie stehen unten noch einmal zum Nachspielen.`;
  if (g) return `Noch kein brillanter Zug, aber schon ${plural(g, "großartiger Fund", "großartige Funde")}. Brillant wird ein Zug, wenn du dafür sauber Material opferst.`;
  return `${Math.round(topPct)} % deiner Züge sind schon der beste Zug. Der erste Glanzzug kommt bestimmt.`;
}

function Versus({ theirs, verdict }: { theirs: string; verdict: -1 | 0 | 1 }) {
  return (
    <>
      Gegner {theirs} · {verdict === 0 ? "kein klarer Unterschied" : <b class={verdict > 0 ? "good" : "bad"}>{verdict > 0 ? "du bist klar besser" : "du bist klar schwächer"}</b>}
    </>
  );
}

export function MovesSummary({ t, onShine }: { t: MoveTally; onShine: () => void }) {
  const s = tallySummary(t);
  const o = s.opponents;
  const parts = TALLY_CLASSES.map((k) => ({ key: k, label: classLabel(k), value: t.counts[k], color: CLASS_COLOR[k] ?? "var(--surface-3)" }));
  return (
    <section class="card span-12 mv-sum" id="s-bilanz">
      <div class="mv-sum-head">
        <span class="eyebrow">
          {plural(t.moves, "Zug", "Züge")} aus {plural(t.games, "analysierter Partie", "analysierten Partien")}
        </span>
        <h2 class="mv-title">
          <CountUp value={s.top_pct} /> von 100 Zügen sind <span>der beste Zug</span>
        </h2>
        <p class="mv-sub">{lead(t, s.top_pct)}</p>
      </div>

      <div class="mv-dist">
        <SplitBar parts={parts} height={14} />
        <div class="mv-groups">
          {KIND_GROUPS.map((g) => {
            const n = sumOf(t.counts, g.classes);
            return (
              <div key={g.key} class={`mv-group g-${g.key}`}>
                <span class="mv-group-name">{g.label}</span>
                <strong class="tnum">{de((n / (t.moves || 1)) * 100, n / (t.moves || 1) < 0.1 ? 1 : 0)} %</strong>
                <span class="tnum">{plural(n, "Zug", "Züge")}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div class="pf-stats mv-stats">
        <Stat
          label="Bester Zug oder besser"
          value={<CountUp value={s.top_pct} format={(v) => `${de(v, 0)} %`} />}
          tone={o?.top_verdict === 1 ? "good" : o?.top_verdict === -1 ? "bad" : undefined}
          sub={o ? <Versus theirs={`${de(o.top_pct, 0)} %`} verdict={o.top_verdict} /> : "brillant, großartig oder bester Zug"}
          title="Anteil deiner Züge, die brillant, großartig oder der beste Zug waren"
        />
        <Stat
          label="Grobe Fehler je 100 Züge"
          value={<CountUp value={s.serious_per_100} format={(v) => de(v)} />}
          tone={o?.serious_verdict === 1 ? "good" : o?.serious_verdict === -1 ? "bad" : undefined}
          sub={o ? <Versus theirs={de(o.serious_per_100)} verdict={o.serious_verdict} /> : "Fehler, verpasste Chancen und Patzer"}
          title="Fehler, verpasste Chancen und Patzer zusammen, je 100 deiner Züge"
        />
        <Stat
          label="Patzer pro Partie"
          value={<CountUp value={s.blunders_per_game} format={(v) => de(v, 2)} />}
          sub={`${plural(t.counts.Blunder, "Patzer", "Patzer")} · ${plural(t.records.blunder_free_games, "Partie", "Partien")} ganz ohne`}
        />
        <Stat label="Glanzzüge" value={<CountUp value={s.shine} />} sub={`${t.counts.Brilliant} brillant · ${t.counts.Great} großartig`}>
          {s.shine > 0 && (
            <button class="link-btn mv-jump" onClick={onShine}>
              Ansehen <IconChevron />
            </button>
          )}
        </Stat>
      </div>
    </section>
  );
}
