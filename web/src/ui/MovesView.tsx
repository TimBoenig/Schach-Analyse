// Statistik · Züge & Fehler: every move of the analysed games. One summary
// on top, all kinds of moves in one table, then the questions that follow
// from it: is it getting better, in which phase, where do the errors happen,
// and which moves were the best.
import { NeedNames } from "./Coach";
import { PageHeader } from "./Layout";
import { ErrorSection } from "./moves/Errors";
import { KindsTable } from "./moves/KindsTable";
import { PhaseTable } from "./moves/PhaseTable";
import { QualityTrend } from "./moves/QualityTrend";
import { ShineSection } from "./moves/Shine";
import { FindingsCard, PunishCard } from "./moves/Side";
import { MovesSummary } from "./moves/Summary";
import { navigate } from "./router";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { scrollToSection, SectionJump, STAT_SECTIONS } from "./StatsLayout";
import { FilterBar, filtersActive, useAllTimeProfile, useProfile } from "./useProfile";
import { t } from "../i18n";

export function MovesView() {
  const { profile, games, usernames, loading, error, filters, setFilters, excludeBullet } = useProfile({ page: "moves" });
  const full = useAllTimeProfile(games, usernames, filters, excludeBullet);
  const tk = profile?.moves ?? null;
  usePageGuide("moves", Boolean(tk));

  const header = <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} actions={tk ? <GuideButton id="moves" /> : undefined} />;

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what={t("zähle ich hier alle deine Züge, von brillant bis Patzer.")} />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "260px" }} />
          <div class="skeleton span-8" style={{ height: "520px" }} />
          <div class="skeleton span-4" style={{ height: "520px" }} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <p class="error">{error}</p>
      </div>
    );
  }
  if (!profile || !tk) {
    return (
      <div>
        {header}
        <div class="empty">
          <p>
            {profile?.total_games
              ? filtersActive(filters)
                ? t("In diesem Zeitraum ist keine Partie analysiert. Wähle oben einen anderen Zeitraum.")
                : t("Noch ist keine Partie analysiert. Danach steht hier jeder brillante Zug und jeder Patzer.")
              : t("Importiere deine Partien und lass sie analysieren, dann zähle ich hier jeden Zug.")}
          </p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            
            {t("Zu den Partien")}
          </button>
        </div>
      </div>
    );
  }

  const toShine = () => scrollToSection("glanz");

  return (
    <div class="moves" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionJump sections={STAT_SECTIONS.moves} />
      <div class="dash mv">
        <MovesSummary t={tk} onShine={toShine} />
        <KindsTable t={tk} onShine={toShine} />
        <div class="span-4 mv-side">
          <FindingsCard t={tk} />
          {profile.deep && <PunishCard punish={profile.deep.punish} />}
        </div>
        <QualityTrend full={full.profile} loading={full.loading} />
        <PhaseTable profile={profile} t={tk} />
        <ErrorSection deep={profile.deep} facts={profile.facts} />
        <ShineSection t={tk} />
      </div>
    </div>
  );
}
