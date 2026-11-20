// Statistik · Überblick: who the player is. One summary on top, the skills
// in one table, what the games show beyond numbers, and the long view.
import { sourceName } from "../domain/profile";
import { trSpeed } from "../domain/i18n";
import { NeedNames } from "./Coach";
import { Foot } from "./kit";
import { PageHeader } from "./Layout";
import { StrengthsCard, StyleCard } from "./profile/Findings";
import { ProfileHero } from "./profile/ProfileHero";
import { SkillsCard } from "./profile/SkillsCard";
import { TrendSection } from "./profile/TrendSection";
import { navigate } from "./router";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { SectionJump, sectionOf, STAT_SECTIONS } from "./StatsLayout";
import { FilterBar, filtersActive, useProfile } from "./useProfile";
import { t } from "../i18n";

export function ProfileView() {
  const { profile, games, usernames, loading, error, filters, setFilters, excludeBullet } = useProfile({ page: "profile" });
  const ready = Boolean(profile && profile.total_games > 0 && !profile.is_empty);
  usePageGuide("profile", ready);

  const header = <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} actions={<GuideButton id="profile" />} />;

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what={t("baue ich dir hier dein Spielerprofil.")} />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "210px" }} />
          <div class="skeleton span-12" style={{ height: "420px" }} />
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
  if (!profile || profile.total_games === 0) {
    return (
      <div>
        {header}
        <div class="empty">
          <p>
            
            {t("Keine Partien für {n} gefunden{n2}.", { n: usernames?.join(", "), n2: filtersActive(filters) ? t(" (mit diesen Filtern)") : "" })}</p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            
            {t("Partien importieren")}
          </button>
        </div>
      </div>
    );
  }

  const rc = profile.rating;
  const sections = profile.is_empty ? [sectionOf("profile", "ueberblick")] : STAT_SECTIONS.profile;

  return (
    <div class="profile" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionJump sections={sections} />
      <div class="dash pf">
        <ProfileHero profile={profile} />
        {profile.is_empty ? (
          <div class="card notice span-12">{t("Noch keine deiner Partien ist analysiert. Analysiere ein paar Partien, dann erscheinen hier Fähigkeiten, Stärken, Schwächen und dein Stil.")}</div>
        ) : (
          <>
            <SkillsCard profile={profile} />
            <StrengthsCard profile={profile} />
            <StyleCard profile={profile} />
          </>
        )}
        <TrendSection games={games} usernames={usernames ?? []} filters={filters} excludeBullet={excludeBullet} rating={rc} />
      </div>
      {rc && !profile.is_empty && (
        <Foot label={t("Womit wird hier verglichen?")}>
          {t("{n}Performance und Ø Gegner zählen nur Partien auf {sourceName} im {trSpeed}, damit keine Wertungen verschiedener Plattformen vermischt werden. Die Erwartung nach Elo rechnet jede Partie mit deiner damaligen Wertung und der des Gegners.", { n: rc.reference === "opponents"
            ? t("„Ø deiner Gegner“ ist, was deine Gegner in denselben {reference_games} analysierten Partien erreicht haben, mit derselben Engine gemessen; das ist genauer als jede feste Tabelle. ", { reference_games: rc.reference_games })
            : t("„Richtwert“ ist eine grobe Schätzung; ab 10 analysierten Partien vergleicht die App stattdessen mit deinen Gegnern. "), sourceName: sourceName(rc.source), trSpeed: trSpeed(rc.speed) })}
        </Foot>
      )}
    </div>
  );
}
