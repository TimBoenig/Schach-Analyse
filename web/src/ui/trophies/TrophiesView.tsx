// Spieler · Trophäen: the collection of everything the games have earned,
// with progress toward the rest and a comparison with friends. All of it is
// computed from the games already in the app (see domain/trophies).
import { useEffect, useMemo, useState } from "preact/hooks";

import { getSetting, setSetting } from "../../storage/db";
import { playerUsernames, type TrackedPlayer } from "../../domain/players";
import {
  collectorLevel,
  compareTrophies,
  evaluateTrophies,
  nextTrophies,
  TIER_LABEL,
  TIER_POINTS,
  TIERS,
  type Tier,
  type TrophyReport,
  type TrophyState,
} from "../../domain/trophies";
import type { StoredGame } from "../../domain/types";
import { NeedNames } from "../Coach";
import { PageHeader } from "../Layout";
import { Meter } from "../kit";
import { navigate } from "../router";
import { Avatar, de, toneOf } from "../players/common";
import { useData } from "../PlayersView";
import { Medal } from "./Medal";
import { t } from "../../i18n";

const SEEN_KEY = "trophies.seen";

type Status = "all" | "unlocked" | "locked";
type Sort = "tier" | "progress" | "name";
type Holder = "all" | "both" | "me" | "them" | "none";

interface Reports {
  me: TrophyReport | null;
  failed?: boolean;
  friends: Record<string, TrophyReport>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Computes the collection of the user and of every friend, one after the
 * other with a pause in between so the page stays responsive on a phone.
 */
function useReports(games: StoredGame[], me: string[], friends: TrackedPlayer[]): Reports {
  const [reports, setReports] = useState<Reports>({ me: null, friends: {} });
  const friendKey = friends.map((f) => `${f.id}:${playerUsernames(f).join(",")}`).join("|");
  useEffect(() => {
    let alive = true;
    if (!me.length) {
      setReports({ me: null, friends: {} });
      return;
    }
    const pause = () => new Promise<void>((r) => setTimeout(r, 0));
    void (async () => {
      await pause();
      if (!alive) return;
      const myNames = me;
      const rivalsOfMe = friends.flatMap(playerUsernames);
      let mine: TrophyReport;
      try {
        mine = evaluateTrophies(games, myNames, { rivals: rivalsOfMe });
      } catch {
        setReports({ me: null, friends: {}, failed: true });
        return;
      }
      setReports((r) => ({ ...r, me: mine, failed: false }));
      const next: Record<string, TrophyReport> = {};
      for (const f of friends) {
        await pause();
        if (!alive) return;
        // Duels of a friend count against you and the other friends.
        const rivals = [...myNames, ...friends.filter((o) => o.id !== f.id).flatMap(playerUsernames)];
        try {
          next[f.id] = evaluateTrophies(games, playerUsernames(f), { rivals });
        } catch {
          continue; // one friend's odd data must not hide the rest
        }
        setReports((r) => ({ ...r, friends: { ...next } }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [games, me.join("\n"), friendKey]);
  return reports;
}

/** Trophies unlocked since the last visit (null on the first visit, so a first look is not all "new"). */
function useFresh(report: TrophyReport | null): Set<string> {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!report) return;
    let alive = true;
    void (async () => {
      const seen = await getSetting<string[] | null>(SEEN_KEY, null);
      if (!alive) return;
      const now = report.states.filter((s) => s.unlocked).map((s) => s.def.id);
      // Marks only ever pile up while the page is open, so a later recalculation does not erase them.
      if (Array.isArray(seen)) setFresh((cur) => new Set([...cur, ...now.filter((id) => !seen.includes(id))]));
      if (!Array.isArray(seen) || now.some((id) => !seen.includes(id))) await setSetting(SEEN_KEY, now);
    })();
    return () => {
      alive = false;
    };
  }, [report]);
  return fresh;
}

/** Name as the card shows it: a locked secret trophy sorts last so the order does not give it away. */
const shownName = (s: TrophyState) => (s.def.secret && !s.unlocked ? "\uffff" : s.def.name);

function progressText(s: TrophyState): string | null {
  const { def } = s;
  if (def.below) {
    // Only a measured percentage or time says anything; a count of moves would not.
    if (!s.measured || !def.unit) return null;
    return t("Bisher: {value}", { value: def.unit === "pct" ? `${de(s.value, 1)} %` : `${de(s.value, 1)} s` });
  }
  const fmt = (v: number) => (def.unit === "pct" ? `${de(v, 1)} %` : def.unit === "sec" ? `${Math.round(v)} s` : String(Math.round(v)));
  const text = `${fmt(Math.min(s.value, def.goal))} / ${fmt(def.goal)}`;
  return s.best ? t("Bestwert {text}", { text }) : text;
}

function TrophyCard({
  s,
  fresh,
  who,
}: {
  s: TrophyState;
  fresh: boolean;
  /** Friend shown beside you: who holds the trophy. */
  who: { name: string; tone: string; theirs: boolean } | null;
}) {
  const { def } = s;
  const hidden = def.secret && !s.unlocked;
  const text = hidden ? null : progressText(s);
  const showBar = !s.unlocked && !hidden && !def.below && def.goal > 1;
  // Only work that adds up can be "almost there"; a best-of value (a rating) can sit at 90 % forever.
  const almost = showBar && !s.best && s.progress >= 0.8;
  return (
    <article class={`tr-card tier-${def.tier}${s.unlocked ? " unlocked" : " locked"}${fresh ? " fresh" : ""}`} data-trophy={def.id}>
      <Medal icon={def.icon} tier={def.tier} locked={!s.unlocked} secret={def.secret} />
      <div class="tr-body">
        <h3 class="tr-name">
          {hidden ? t("Geheime Trophäe") : def.name}
          {fresh && <span class="tr-new">{t("Neu")}</span>}
        </h3>
        <p class="tr-about">{hidden ? t("Spiel weiter, dann zeigt sie sich von selbst.") : def.about}</p>
        {showBar && (
          <span class="tr-progress">
            <Meter value={s.progress * 100} max={100} tone="tr-meter" />
            {text && <span class="tr-count tnum">{text}</span>}
          </span>
        )}
        {!showBar && !s.unlocked && text && <span class="tr-count tnum">{text}</span>}
        <span class="tr-meta">
          <span class={`tr-tier tier-${def.tier}`}>{TIER_LABEL[def.tier]}</span>
          {def.quirky && !hidden && <span class="tr-tag">{t("Kurios")}</span>}
          {almost && <span class="tr-tag tr-almost">{t("Fast geschafft")}</span>}
          {s.unlocked && s.game && (
            <button class="tr-link" onClick={() => navigate({ view: "analysis", gameId: s.game })}>
              {t("Partie ansehen")}
            </button>
          )}
          {who && (
            <span class="tr-holders" title={who.theirs ? t("{name} hat diese Trophäe", { name: who.name }) : t("{name} hat diese Trophäe noch nicht", { name: who.name })}>
              <Avatar name={who.name} tone={who.tone} size="sm" ring={who.theirs} />
              <span class={who.theirs ? "tr-has" : "tr-hasnt"}>{who.theirs ? t("auch bei {name}", { name: who.name }) : t("{name} fehlt sie", { name: who.name })}</span>
            </span>
          )}
        </span>
      </div>
      <span class="tr-points tnum" title={t("Punkte für die Sammlung")}>{TIER_POINTS[def.tier]}</span>
    </article>
  );
}

function Hero({ report, loading }: { report: TrophyReport | null; loading: boolean }) {
  if (!report) return <div class="skeleton span-12" style={{ height: "170px" }} />;
  const next = nextTrophies(report, 4);
  const level = collectorLevel(report.points, report.maxPoints);
  return (
    <section class="card tr-hero span-12">
      <div class="tr-hero-main">
        <Medal icon="trophy" tier="legendary" size="lg" />
        <div>
          <div class="tr-big tnum">
            {report.unlocked}
            <span class="tr-of"> / {report.total}</span>
          </div>
          <div class="tr-sub">{t("Trophäen gesammelt")}</div>
          <div class="tr-sub faint">
            {t("{points} von {max} Punkten", { points: report.points, max: report.maxPoints })}
            {" · "}
            {plural(report.games, t("gezählte Partie"), t("gezählte Partien"))}
          </div>
          <div class="tr-level">
            <span class="tr-level-name">{t("Rang: {name}", { name: level.name })}</span>
            {level.next ? (
              <>
                <Meter value={level.progress * 100} max={100} tone="tr-meter" />
                <span class="tr-count tnum">{t("Noch {n} Punkte bis {name}", { n: level.missing, name: level.next })}</span>
              </>
            ) : (
              <span class="tr-count">{t("Höchster Rang erreicht")}</span>
            )}
          </div>
        </div>
      </div>
      <ul class="tr-tiers">
        {TIERS.map((tier) => {
          const b = report.byTier[tier];
          return (
            <li key={tier} class={`tier-${tier}`}>
              <span class="tr-tier-name">{TIER_LABEL[tier]}</span>
              <Meter value={b.unlocked} max={b.total} tone="tr-meter" />
              <span class="tr-count tnum">
                {b.unlocked} / {b.total}
              </span>
            </li>
          );
        })}
      </ul>
      <div class="tr-next">
        <h3>{t("Als Nächstes erreichbar")}</h3>
        {next.length ? (
          <ul>
            {next.map((s) => (
              <li key={s.def.id} class={`tier-${s.def.tier}`}>
                <Medal icon={s.def.icon} tier={s.def.tier} locked />
                <span class="tr-next-text">
                  <strong>{s.def.secret ? t("Geheime Trophäe") : s.def.name}</strong>
                  <Meter value={s.progress * 100} max={100} tone="tr-meter" />
                </span>
                <span class="tr-count tnum">{progressText(s)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="small faint">{loading ? t("Wird berechnet …") : t("Spiel weiter, dann zeigen sich hier die nächsten Ziele.")}</p>
        )}
      </div>
    </section>
  );
}

/** What was unlocked since the last visit, with a short burst of sparks around each new medal. */
function FreshBanner({ report, fresh }: { report: TrophyReport; fresh: Set<string> }) {
  const list = report.states.filter((s) => fresh.has(s.def.id) && s.unlocked);
  if (!list.length) return null;
  return (
    <section class="card tr-fresh span-12" aria-live="polite">
      <h2>{plural(list.length, t("neue Trophäe seit deinem letzten Besuch"), t("neue Trophäen seit deinem letzten Besuch"))}</h2>
      <ul>
        {list.map((s) => (
          <li key={s.def.id} class={`tier-${s.def.tier}`}>
            <span class="tr-burst">
              <Medal icon={s.def.icon} tier={s.def.tier} secret={false} />
            </span>
            <span class="tr-fresh-text">
              <strong>{s.def.name}</strong>
              <span class="small faint">{s.def.about}</span>
            </span>
            <span class="tr-points tnum">{TIER_POINTS[s.def.tier]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FriendsCard({
  players,
  mine,
  reports,
  picked,
  onPick,
}: {
  players: TrackedPlayer[];
  mine: TrophyReport;
  reports: Record<string, TrophyReport>;
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const rows = [
    { id: "ich", name: t("Du"), tone: "tone-me", report: mine },
    ...players.map((p) => ({ id: p.id, name: p.name, tone: toneOf(players, p.id), report: reports[p.id] ?? null })),
  ].sort((a, b) => (b.report?.points ?? -1) - (a.report?.points ?? -1));
  // The bars grow to the leader, so a small gap between friends is still visible.
  const top = Math.max(1, ...rows.map((r) => r.report?.points ?? 0));
  const friend = players.find((p) => p.id === picked);
  const theirs = friend ? reports[friend.id] : null;
  const diff = theirs ? compareTrophies(mine, theirs) : null;
  return (
    <section class="card tr-friends span-12">
      <div class="tr-friends-head">
        <h2>{t("Mit Freunden vergleichen")}</h2>
        <p class="small faint">{t("Tippe auf einen Freund, dann siehst du unten, welche Trophäen ihr teilt und welche nur einer hat.")}</p>
      </div>
      <ul class="tr-board">
        {rows.map((r, i) => {
          const isFriend = r.id !== "ich";
          const on = r.id === picked;
          return (
            <li key={r.id} class={`${on ? "on" : ""}${isFriend ? " pick" : ""}`}>
              <button class="tr-row" disabled={!isFriend} aria-pressed={isFriend ? on : undefined} onClick={() => onPick(on ? null : r.id)}>
                <span class="tr-place tnum">{r.report ? i + 1 : "–"}</span>
                <Avatar name={r.name} tone={r.tone} size="sm" />
                <span class="tr-row-name">{r.name}</span>
                <span class="tr-row-bar">{r.report ? <Meter value={r.report.points} max={top} tone="tr-meter" /> : <span class="small faint">{t("Wird berechnet …")}</span>}</span>
                <span class="tr-row-count tnum">{r.report ? t("{n} Trophäen", { n: r.report.unlocked }) : ""}</span>
                <span class="tr-row-points tnum">{r.report ? t("{n} Punkte", { n: r.report.points }) : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {friend && diff && (
        <div class="tr-diff">
          <div class="stat">
            <span class="stat-label">{t("Gemeinsam")}</span>
            <span class="stat-value tnum">{diff.both.length}</span>
          </div>
          <div class="stat">
            <span class="stat-label">{t("Nur du")}</span>
            <span class="stat-value tnum good">{diff.onlyA.length}</span>
          </div>
          <div class="stat">
            <span class="stat-label">{t("Nur {name}", { name: friend.name })}</span>
            <span class="stat-value tnum">{diff.onlyB.length}</span>
          </div>
          <div class="stat">
            <span class="stat-label">{t("Keiner von beiden")}</span>
            <span class="stat-value tnum">{diff.neither.length}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function TrophiesView({ playerId }: { playerId?: string }) {
  const { players, games, me } = useData();
  const friends = useMemo(() => (players ?? []).filter((p) => p.friend && !p.hidden), [players]);
  const { me: mine, friends: friendReports, failed } = useReports(games, me, friends);
  const fresh = useFresh(mine);
  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("all");
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [quirky, setQuirky] = useState(false);
  const [holder, setHolder] = useState<Holder>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("tier");

  // A link to #/trophaeen/<friend> opens with that friend picked.
  useEffect(() => {
    if (playerId && friends.some((f) => f.id === playerId)) setPicked(playerId);
  }, [playerId, friends.map((f) => f.id).join("|")]);
  useEffect(() => {
    if (picked && !friends.some((f) => f.id === picked)) setPicked(null);
  }, [friends.map((f) => f.id).join("|")]);

  const friend = friends.find((f) => f.id === picked) ?? null;
  const theirs = friend ? (friendReports[friend.id] ?? null) : null;
  const diff = useMemo(() => (mine && theirs ? compareTrophies(mine, theirs) : null), [mine, theirs]);
  const theirsById = useMemo(() => new Map((theirs?.states ?? []).map((s) => [s.def.id, s.unlocked])), [theirs]);
  useEffect(() => setHolder("all"), [picked]);

  if (!players) {
    return (
      <div>
        <PageHeader />
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "170px" }} />
        </div>
      </div>
    );
  }
  if (!me.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what={t("sammle ich hier deine Trophäen.")} />
      </div>
    );
  }

  if (failed) {
    return (
      <div>
        <PageHeader />
        <p class="error">{t("Die Trophäen konnten nicht berechnet werden.")}</p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = (mine?.states ?? []).filter((s) => {
    if (status === "unlocked" && !s.unlocked) return false;
    if (status === "locked" && s.unlocked) return false;
    if (tiers.length && !tiers.includes(s.def.tier)) return false;
    if (quirky && !s.def.quirky) return false;
    // A secret trophy stays unsearchable until earned, or the search would give it away.
    if (q && (s.def.secret && !s.unlocked ? true : !`${s.def.name} ${s.def.about}`.toLowerCase().includes(q))) return false;
    if (diff && holder !== "all") {
      const id = s.def.id;
      const set = { both: diff.both, me: diff.onlyA, them: diff.onlyB, none: diff.neither }[holder];
      if (!set.includes(id)) return false;
    }
    return true;
  });
  const toggleTier = (tier: Tier) => setTiers((cur) => (cur.includes(tier) ? cur.filter((x) => x !== tier) : [...cur, tier]));
  const first = (a: TrophyState, b: TrophyState) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress;

  return (
    <div class="tr-page">
      <PageHeader />
      <div class="dash">
        <Hero report={mine} loading />
        {mine && <FreshBanner report={mine} fresh={fresh} />}
        {mine && friends.length > 0 && <FriendsCard players={friends} mine={mine} reports={friendReports} picked={picked} onPick={setPicked} />}
        {mine && friends.length === 0 && (
          <p class="small faint span-12 tr-hint">
            {t("Füge unter Spieler Freunde hinzu, dann kannst du deine Sammlung hier mit ihrer vergleichen.")}{" "}
            <button class="tr-link" onClick={() => navigate({ view: "players" })}>
              {t("Zu den Spielern")}
            </button>
          </p>
        )}
      </div>

      {mine && (
        <>
          <div class="tr-filters" role="group" aria-label={t("Trophäen filtern")}>
            <div class="segmented" role="group" aria-label={t("Status")}>
              {(
                [
                  ["all", t("Alle")],
                  ["unlocked", t("Freigeschaltet")],
                  ["locked", t("Gesperrt")],
                ] as [Status, string][]
              ).map(([key, label]) => (
                <button key={key} class={status === key ? "active" : ""} aria-pressed={status === key} onClick={() => setStatus(key)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              class="tr-search"
              type="search"
              value={query}
              placeholder={t("Trophäe suchen …")}
              aria-label={t("Trophäe suchen")}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
            <div class="segmented" role="group" aria-label={t("Sortierung")}>
              {(
                [
                  ["tier", t("Nach Seltenheit")],
                  ["progress", t("Nach Fortschritt")],
                  ["name", t("A–Z")],
                ] as [Sort, string][]
              ).map(([key, label]) => (
                <button key={key} class={sort === key ? "active" : ""} aria-pressed={sort === key} onClick={() => setSort(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div class="tr-chips" role="group" aria-label={t("Seltenheit")}>
              {TIERS.map((tier) => (
                <button key={tier} class={`chip tr-chip tier-${tier}${tiers.includes(tier) ? " on" : ""}`} aria-pressed={tiers.includes(tier)} onClick={() => toggleTier(tier)}>
                  {TIER_LABEL[tier]}
                </button>
              ))}
              <button class={`chip tr-chip${quirky ? " on" : ""}`} aria-pressed={quirky} onClick={() => setQuirky(!quirky)}>
                {t("Kurios")}
              </button>
            </div>
            {friend && diff && (
              <div class="segmented" role="group" aria-label={t("Wer hat sie?")}>
                {(
                  [
                    ["all", t("Alle")],
                    ["both", t("Gemeinsam")],
                    ["me", t("Nur du")],
                    ["them", t("Nur {name}", { name: friend.name })],
                    ["none", t("Keiner")],
                  ] as [Holder, string][]
                ).map(([key, label]) => (
                  <button key={key} class={holder === key ? "active" : ""} aria-pressed={holder === key} onClick={() => setHolder(key)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {friend && !theirs && <p class="small faint tr-hint">{t("Die Sammlung von {name} wird berechnet …", { name: friend.name })}</p>}
          {friend && theirs && theirs.games === 0 && (
            <p class="notice tr-hint">{t("Von {name} sind noch keine Partien geladen, deshalb ist die Sammlung leer.", { name: friend.name })}</p>
          )}

          {sort !== "tier" && shown.length > 0 && (
            <div class="tr-grid tr-flat">
              {[...shown]
                .sort(sort === "name" ? (a, b) => shownName(a).localeCompare(shownName(b)) : (a, b) => Number(a.unlocked) - Number(b.unlocked) || b.progress - a.progress)
                .map((s) => (
                  <TrophyCard
                    key={s.def.id}
                    s={s}
                    fresh={fresh.has(s.def.id)}
                    who={friend && theirs ? { name: friend.name, tone: toneOf(friends, friend.id), theirs: theirsById.get(s.def.id) ?? false } : null}
                  />
                ))}
            </div>
          )}
          {sort === "tier" && TIERS.map((tier) => {
            const list = shown.filter((s) => s.def.tier === tier).sort(first);
            if (!list.length) return null;
            const b = mine.byTier[tier];
            return (
              <section key={tier} class={`tr-group tier-${tier}`}>
                <h2 class="tr-group-head">
                  <span>{TIER_LABEL[tier]}</span>
                  <span class="tr-count tnum">
                    {b.unlocked} / {b.total}
                  </span>
                </h2>
                <div class="tr-grid">
                  {list.map((s) => (
                    <TrophyCard
                      key={s.def.id}
                      s={s}
                      fresh={fresh.has(s.def.id)}
                      who={friend && theirs ? { name: friend.name, tone: toneOf(friends, friend.id), theirs: theirsById.get(s.def.id) ?? false } : null}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {!shown.length && <p class="empty-note faint">{t("Keine Trophäe passt zu diesem Filter.")}</p>}
        </>
      )}
    </div>
  );
}
