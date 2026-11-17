// "Glanzzüge und Rekorde": the streaks, every brilliant and great move to
// replay, and the games with the most of them.
import { useState } from "preact/hooks";

import type { MoveTally } from "../../domain/profile";
import { IconChevron } from "../icons";
import { formatDate } from "../labels";
import { ClassBadge } from "../MoveTally";
import { navigate } from "../router";
import { Stat } from "../viz/Bars";
import { de, PHASE_SHORT, plural } from "./shared";

const HIGHLIGHTS_SHOWN = 8;

function Records({ t }: { t: MoveTally }) {
  const r = t.records;
  return (
    <section class="card span-12 mv-records">
      <Stat label="Partien mit Brillanz" value={r.games_with_brilliant} sub={`von ${plural(t.games, "Partie", "Partien")}`} />
      <Stat label="Meiste Brillanz in einer Partie" value={r.most_brilliant} sub={r.most_brilliant === 1 ? "brillanter Zug" : "brillante Züge"} />
      <Stat label="Partien ohne Patzer" value={r.blunder_free_games} sub={`${Math.round((r.blunder_free_games / t.games) * 100)} % deiner Partien`} />
      <Stat label="Längste Serie ohne Patzer" value={r.longest_blunder_free} sub={r.longest_blunder_free === 1 ? "Partie am Stück" : "Partien am Stück"} />
      <Stat label="Aktuelle Serie ohne Patzer" value={r.current_blunder_free} sub={r.current_blunder_free === 1 ? "Partie" : "Partien"} tone={r.current_blunder_free > 0 && r.current_blunder_free === r.longest_blunder_free ? "good" : undefined} />
    </section>
  );
}

export function ShineSection({ t }: { t: MoveTally }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <div class="span-12 sec-head" id="s-glanz">
        <div>
          <h2>Glanzzüge und Rekorde</h2>
          <p>Deine besten Momente zum Nachspielen.</p>
        </div>
      </div>
      <Records t={t} />

      <section class="card span-7 mv-shine">
        <header class="card-head">
          <div>
            <h3>Deine Glanzzüge</h3>
            <p class="card-sub">Brillant und großartig, die neuesten zuerst.</p>
          </div>
          {t.highlights.length > 0 && <span class="card-tag tnum">{t.highlights.length}</span>}
        </header>
        {t.highlights.length ? (
          <div class="mv-list">
            {t.highlights.slice(0, all ? undefined : HIGHLIGHTS_SHOWN).map((m) => (
              <button key={`${m.game_id}-${m.ply_index}`} class="tn-row" onClick={() => navigate({ view: "analysis", gameId: m.game_id, ply: m.ply_index + 1 })}>
                <ClassBadge c={m.classification} size={22} />
                <span class="tn-row-title">
                  <span class="tnum">{m.move}</span>
                  <small>
                    gegen {m.opponent}
                    {PHASE_SHORT[m.phase] ? ` · ${PHASE_SHORT[m.phase]}` : ""}
                  </small>
                </span>
                <span class="mv-date tnum">{formatDate(m.date)}</span>
                <IconChevron />
              </button>
            ))}
            {t.highlights.length > HIGHLIGHTS_SHOWN && (
              <button class="btn small ghost tx-more" onClick={() => setAll((v) => !v)}>
                {all ? "Weniger zeigen" : `Alle ${t.highlights.length} zeigen`}
              </button>
            )}
          </div>
        ) : (
          <p class="tn-none">Noch keine brillanten oder großartigen Züge. Sie erscheinen hier, sobald du einen findest.</p>
        )}
      </section>

      <section class="card span-5 mv-shine">
        <header class="card-head">
          <div>
            <h3>Deine glänzendsten Partien</h3>
            <p class="card-sub">Die Partien mit den meisten Glanzzügen.</p>
          </div>
        </header>
        {t.top_games.length ? (
          <div class="mv-list">
            {t.top_games.map((g) => (
              <button key={g.game_id} class="tn-row" onClick={() => navigate({ view: "analysis", gameId: g.game_id, ply: g.first_ply !== undefined ? g.first_ply + 1 : undefined })}>
                <span class="mv-badges">
                  {g.brilliant > 0 && (
                    <span class="tnum">
                      <ClassBadge c="Brilliant" size={18} /> {g.brilliant}
                    </span>
                  )}
                  {g.great > 0 && (
                    <span class="tnum">
                      <ClassBadge c="Great" size={18} /> {g.great}
                    </span>
                  )}
                </span>
                <span class="tn-row-title">
                  <span>gegen {g.opponent}</span>
                  <small>
                    {formatDate(g.date)} · {de(g.accuracy, 0)} % Genauigkeit
                  </small>
                </span>
                <IconChevron />
              </button>
            ))}
          </div>
        ) : (
          <p class="tn-none">Sobald eine Partie einen Glanzzug hat, steht sie hier.</p>
        )}
      </section>
    </>
  );
}
