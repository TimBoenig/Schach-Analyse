// A fair comparison with the Game Review on Chess.com. Rules for this table, because
// it names another company: only facts the other side states itself on its public
// support pages (source and date under the table), no logo, no brand colours, no
// claims about quality, and the rows where Chess.com is simply the bigger offer stay in.
import { BRAND } from "../../brand";
import { t } from "../../i18n";

type Cell = string | boolean;
// Rows are grouped. The second group lists what this app does on top of a single-game
// review. Its Chess.com cells are scoped to the Game Review on purpose: other parts of
// Chess.com (Insights, lessons) may cover some of it, and the caption says so.
const NOT_IN_REVIEW = t("nicht Teil des Game Review");
const GROUPS: { title: string; rows: { what: string; them: Cell; us: Cell }[] }[] = [
  {
    title: t("Die einzelne Partie"),
    rows: [
      { what: t("Bewertet jeden Zug einer Partie (Brillant bis Patzer)"), them: true, us: true },
      { what: t("Partieanalyse ohne Bezahlung"), them: t("ja, mit Tageslimit"), us: t("ja, ohne Limit") },
    ],
  },
  {
    title: t("Über viele Partien und mit Freunden"),
    rows: [
      { what: t("Wiederkehrende Fehlermuster nach Phase und Motiv, erst ab genug Partien"), them: NOT_IN_REVIEW, us: true },
      { what: t("Zugbilanz: jeder Zug gezählt, wann, wo und womit Fehler passieren"), them: NOT_IN_REVIEW, us: true },
      { what: t("Eröffnungsbaum aus deinen Partien mit Lücken"), them: NOT_IN_REVIEW, us: true },
      { what: t("Freundesvergleich bei gleicher Bedenkzeit und gleicher Analysetiefe"), them: NOT_IN_REVIEW, us: true },
      { what: t("Liga mit Freunden: Stärke aus Ergebnissen und Zugqualität"), them: NOT_IN_REVIEW, us: true },
      { what: t("Wochenplan aus deinen eigenen Fehlern, verteilt wiederholt"), them: NOT_IN_REVIEW, us: true },
      { what: t("KI-Export deiner Auswertung als Text für einen Chat"), them: NOT_IN_REVIEW, us: true },
      { what: t("Engine rechnet im Browser, auch offline"), them: NOT_IN_REVIEW, us: true },
    ],
  },
  {
    title: t("Rundherum"),
    rows: [
      { what: t("Statistik über alle deine Partien"), them: t("Insights, im Diamond-Abo"), us: t("kostenlos") },
      { what: t("Gegen andere Menschen spielen, Lektionen, große Community"), them: true, us: false },
      { what: t("Preis"), them: t("Gratis-Stufe und Abos"), us: t("komplett kostenlos") },
    ],
  },
];

const SOURCE = "https://support.chess.com/en/articles/8584089-how-does-game-review-work";

function Mark({ v }: { v: Cell }) {
  if (typeof v === "string") return <span class="ld-cmp-text">{v}</span>;
  return v ? (
    <span class="ld-cmp-yes" aria-label={t("ja")}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  ) : (
    <span class="ld-cmp-no" aria-label={t("nein")}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 8h8" />
      </svg>
    </span>
  );
}

export function CompareTable() {
  return (
    <figure class="ld-cmp-wrap">
      <table class="ld-cmp">
        <caption class="sr-only">{t("Vergleich: Game Review auf Chess.com und {BRAND}", { BRAND })}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span class="sr-only">{t("Funktion")}</span>
            </th>
            <th scope="col">{t("Game Review auf Chess.com")}</th>
            <th scope="col" class="us">
              {BRAND}
            </th>
          </tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g.title}>
            <tr class="ld-cmp-group">
              <th scope="colgroup" colSpan={3}>
                {g.title}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.what}>
                <th scope="row">{r.what}</th>
                <td>
                  <Mark v={r.them} />
                </td>
                <td class="us">
                  <Mark v={r.us} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <figcaption class="ld-note">
        {t("Angaben zu Chess.com nach deren öffentlicher Hilfeseite, Stand November 2026, ohne Gewähr: ")}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer">
          {"support" + ".chess.com"}
        </a>
        {t(". Chess.com ist eine Marke der Chess.com, LLC. {BRAND} gehört nicht dazu und ist weder mit Chess.com verbunden noch von dort empfohlen. Was aktuell gilt, steht dort.", { BRAND })}
        {" "}
        {t("„Nicht Teil des Game Review“ heißt nur: Das Game Review selbst bietet es nicht. Andere Bereiche von Chess.com können Teile davon abdecken.")}
      </figcaption>
    </figure>
  );
}
