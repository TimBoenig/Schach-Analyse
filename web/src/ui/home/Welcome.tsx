// The start page before the app knows who is playing: Lucena introduces
// herself and the one button opens her guided setup in full screen.
import { BRAND } from "../../brand";
import { syncAvailable } from "../../storage/sync";
import { CoachAvatar, COACH_NAME } from "../Coach";
import { IconPlay, IconUpload } from "../icons";
import { navigate } from "../router";
import { openStage } from "../stage/store";
import { t } from "../../i18n";

const STEPS = [
  { title: t("Wie heißt du?"), text: t("Dein Name auf chess.com oder Lichess, damit ich deine Partien erkenne.") },
  { title: t("Deine Partien"), text: t("Ich hole sie mit einem Klick oder du lädst eine PGN-Datei.") },
  { title: t("Dein Plan"), text: t("Ich analysiere alles auf deinem Gerät und zeige dir, woran du arbeiten solltest.") },
];

export function Welcome() {
  return (
    <div class="hm-welcome">
      <section class="card hm-welcome-card">
        <p class="brand-mark">
          <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          {BRAND}
        </p>
        <CoachAvatar size={132} mood="wow" />
        <h1>{t("Hi, ich bin {COACH_NAME}.", { COACH_NAME })}</h1>
        <p class="hm-welcome-lead">{t("Ich bin dein KI-Coach. In drei Schritten richten wir alles ein, danach führe ich dich durch die App.")}</p>
        <ol class="hm-welcome-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span class="tnum">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </div>
            </li>
          ))}
        </ol>
        <div class="hm-welcome-actions">
          <button class="btn primary big" onClick={() => openStage({ kind: "onboarding" })}>
            <IconPlay />  {t("Mit {COACH_NAME} einrichten", { COACH_NAME })}</button>
          <button class="btn big" onClick={() => navigate({ view: "games", import: true })}>
            <IconUpload />  {t("Nur Partien importieren")}
          </button>
        </div>
        {syncAvailable() && (
          <p class="small muted">
            
            {t("Schon ein Konto?")}{" "}
            <button class="link-btn" onClick={() => navigate({ view: "account" })}>
              
              {t("Anmelden und alles zurückholen")}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
