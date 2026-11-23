// A fair comparison with the Game Review on Chess.com. Rules for this table, because
// it names another company: only facts the other side states itself on its public
// support pages (source and date under the table), no logo, no brand colours, no
// claims about quality, and the rows where Chess.com is simply the bigger offer stay in.
import { BRAND } from "../../brand";
import { t } from "../../i18n";

type Cell = string | boolean;
const ROWS: { what: string; them: Cell; us: Cell }[] = [
  { what: t("Bewertet jeden Zug einer Partie (Brillant bis Patzer)"), them: true, us: true },
  { what: t("Partieanalyse ohne Bezahlung"), them: t("ja, mit Tageslimit"), us: t("ja, ohne Limit") },
  { what: t("Statistik über alle deine Partien"), them: t("Insights, im Diamond-Abo"), us: t("kostenlos") },
  { what: t("Gegen andere Menschen spielen, Lektionen, große Community"), them: true, us: false },
  { what: t("Preis"), them: t("Gratis-Stufe und Abos"), us: t("komplett kostenlos") },
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
        <tbody>
          {ROWS.map((r) => (
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
      </table>
      <figcaption class="ld-note">
        {t("Angaben zu Chess.com nach deren öffentlicher Hilfeseite, Stand November 2026, ohne Gewähr: ")}
        <a href={SOURCE} target="_blank" rel="noopener noreferrer">
          {"support" + ".chess.com"}
        </a>
        {t(". Chess.com ist eine Marke der Chess.com, LLC. {BRAND} gehört nicht dazu und ist weder mit Chess.com verbunden noch von dort empfohlen. Was aktuell gilt, steht dort.", { BRAND })}
      </figcaption>
    </figure>
  );
}
