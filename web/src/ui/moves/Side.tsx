// Beside the table of move kinds: what the counts clearly show, and how
// often an opponent's error was punished.
import type { DeepInsights, MoveTally } from "../../domain/profile";
import { MIN_BUCKET_MOVES } from "../../domain/profile/evidence";
import { Ring } from "../charts";
import { IconPlay } from "../icons";
import { navigate } from "../router";

export function FindingsCard({ t }: { t: MoveTally }) {
  return (
    <section class="card mv-find">
      <header class="card-head">
        <div>
          <h3>Was die Zahlen zeigen</h3>
          <p class="card-sub">Nur was viele Züge klar belegen.</p>
        </div>
      </header>
      {t.findings.length ? (
        <ul class="fd-list">
          {t.findings.map((f) => (
            <li class={`fd-item ${f.tone}`} key={f.key}>
              <span class="fd-mark" aria-hidden="true" />
              <div>
                <strong>{f.title}</strong>
                <p class="small">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="tn-none">
          Noch kein klarer Unterschied zu den Gegnern, zwischen den Partiephasen oder zu früher. Genannt wird nur, was mindestens {MIN_BUCKET_MOVES} Züge pro Gruppe zeigen und kein Zufall
          sein kann.
        </p>
      )}
    </section>
  );
}

export function PunishCard({ punish }: { punish: DeepInsights["punish"] }) {
  if (!punish.chances || punish.rate === null) return null;
  return (
    <section class="card mv-punish">
      <header class="card-head">
        <div>
          <h3>Wenn dein Gegner patzt</h3>
          <p class="card-sub">Wie oft du den Vorteil danach festhältst.</p>
        </div>
      </header>
      <div class="mv-punish-body">
        <Ring value={punish.punished} total={punish.chances} size={84} thickness={8}>
          <strong class="tnum">{Math.round(punish.rate)} %</strong>
        </Ring>
        <p>
          <strong class="tnum">
            {punish.punished} von {punish.chances}
          </strong>{" "}
          groben Fehlern deiner Gegner hast du bestraft. Die anderen findest du als Übungen wieder.
        </p>
      </div>
      <button class="btn small" onClick={() => navigate({ view: "training", tab: "uebungen", category: "chance" })}>
        <IconPlay /> Chancen nutzen üben
      </button>
    </section>
  );
}
