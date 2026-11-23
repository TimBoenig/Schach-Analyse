// The trophy collection: every trophy is one row, a stat (see stats.ts) and a
// goal. Tiers say how hard a trophy is to earn, by design: they are not
// measured against other players. Texts are German in the code, English in
// i18n/en.ts like everywhere else.
import { t } from "../../i18n";
import type { StatKey } from "./stats";

export type Tier = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const TIERS: Tier[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Points a trophy of each tier is worth in the collection score. */
export const TIER_POINTS: Record<Tier, number> = { common: 5, uncommon: 10, rare: 25, epic: 50, legendary: 100 };

export const TIER_LABEL: Record<Tier, string> = {
  common: t("Gewöhnlich"),
  uncommon: t("Ungewöhnlich"),
  rare: t("Selten"),
  epic: t("Episch"),
  legendary: t("Legendär"),
};

/** Icon names the page maps to its drawings (the domain does not import UI). */
export type TrophyIcon =
  | "bolt" | "board" | "calendar" | "check" | "cpu" | "crown" | "flame" | "games" | "gauge" | "globe" | "hourglass"
  | "knight" | "moon" | "openings" | "pawn" | "reset" | "rise" | "shield" | "skull" | "spark" | "star" | "sun"
  | "swords" | "timer" | "trophy";

export interface TrophyDef {
  id: string;
  tier: Tier;
  icon: TrophyIcon;
  name: string;
  about: string;
  stat: StatKey;
  goal: number;
  /** The trophy is earned by a value at or below the goal (lowest win chance, shortest win). */
  below?: boolean;
  /** Funny or odd rather than hard: gets its own filter. */
  quirky?: boolean;
  /** Name and rule stay hidden until it is earned. */
  secret?: boolean;
  /** One game shows the trophy: the page links to it. */
  proof?: boolean;
  /** How the number reads in the progress line. */
  unit?: "pct" | "sec";
}

export const TROPHIES: TrophyDef[] = [
  { id: "first-win", tier: "common", icon: "check", name: t("Erster Sieg"), about: t("Gewinne deine erste Partie."), stat: "wins", goal: 1 },
  { id: "warm-up", tier: "common", icon: "games", name: t("Warmgespielt"), about: t("Spiele 10 Partien."), stat: "games", goal: 10 },
  { id: "ten-wins", tier: "common", icon: "star", name: t("Zehn Siege"), about: t("Gewinne 10 Partien."), stat: "wins", goal: 10 },
  { id: "first-draw", tier: "common", icon: "shield", name: t("Friedensschluss"), about: t("Beende eine Partie mit Remis."), stat: "draws", goal: 1, proof: true },
  { id: "first-analysis", tier: "common", icon: "cpu", name: t("Neugierig"), about: t("Lass eine Partie von der Engine analysieren."), stat: "analyzed", goal: 1 },
  { id: "dark-side", tier: "common", icon: "moon", name: t("Die dunkle Seite"), about: t("Gewinne eine Partie mit Schwarz."), stat: "wins_black", goal: 1 },
  { id: "first-mate", tier: "common", icon: "crown", name: t("Schachmatt!"), about: t("Setze deinen Gegner matt."), stat: "mates", goal: 1, proof: true },
  { id: "hat-trick", tier: "common", icon: "flame", name: t("Hattrick"), about: t("Gewinne 3 Partien in Folge."), stat: "win_streak", goal: 3 },
  { id: "flag-thief", tier: "common", icon: "hourglass", name: t("Uhrendieb"), about: t("Gewinne eine Partie, weil dem Gegner die Zeit ausgeht."), stat: "timeout_wins", goal: 1, proof: true },
  { id: "pawn-to-queen", tier: "common", icon: "pawn", name: t("Bauer wird Dame"), about: t("Wandle einen Bauern um."), stat: "promotions", goal: 1, proof: true },
  { id: "long-way", tier: "common", icon: "shield", name: t("Der lange Weg"), about: t("Rochiere einmal lang."), stat: "queenside_castles", goal: 1, proof: true },
  { id: "sticking-with-it", tier: "common", icon: "calendar", name: t("Dranbleiber"), about: t("Spiele an 3 Tagen hintereinander."), stat: "day_streak", goal: 3 },
  { id: "opening-tourist", tier: "common", icon: "openings", name: t("Eröffnungs-Tourist"), about: t("Spiele 5 verschiedene Eröffnungen."), stat: "openings_distinct", goal: 5 },
  { id: "lightning-strike", tier: "common", icon: "bolt", name: t("Blitzschlag"), about: t("Gewinne 5 Blitzpartien."), stat: "blitz_wins", goal: 5 },
  { id: "steady-hand", tier: "common", icon: "timer", name: t("Ruhige Hand"), about: t("Gewinne 5 Schnellschachpartien."), stat: "rapid_wins", goal: 5 },
  { id: "bullet-time", tier: "common", icon: "bolt", name: t("Kugelblitz"), about: t("Gewinne eine Bullet-Partie."), stat: "bullet_wins", goal: 1, proof: true },
  { id: "tick-tock", tier: "common", icon: "hourglass", name: t("Die Uhr tickt"), about: t("Verliere eine Partie auf Zeit."), stat: "timeout_losses", goal: 1, quirky: true, proof: true },
  { id: "queen-first", tier: "common", icon: "crown", name: t("Dame voran"), about: t("Ziehe deine Dame in den ersten drei Zügen."), stat: "early_queen_games", goal: 1, quirky: true, proof: true },
  { id: "hundred-games", tier: "uncommon", icon: "games", name: t("Hundert Partien"), about: t("Spiele 100 Partien."), stat: "games", goal: 100 },
  { id: "wins-25", tier: "uncommon", icon: "star", name: t("Fünfundzwanzig Siege"), about: t("Gewinne 25 Partien."), stat: "wins", goal: 25 },
  { id: "regular", tier: "uncommon", icon: "calendar", name: t("Stammgast"), about: t("Spiele an 30 verschiedenen Tagen."), stat: "days_active", goal: 30 },
  { id: "winning-streak", tier: "uncommon", icon: "flame", name: t("Siegesserie"), about: t("Gewinne 5 Partien in Folge."), stat: "win_streak", goal: 5 },
  { id: "mate-maker", tier: "uncommon", icon: "crown", name: t("Mattmacher"), about: t("Setze 10 Mal matt."), stat: "mates", goal: 10 },
  { id: "self-observer", tier: "uncommon", icon: "cpu", name: t("Selbstbeobachter"), about: t("Lass 25 Partien analysieren."), stat: "analyzed", goal: 25 },
  { id: "flash-of-genius", tier: "uncommon", icon: "spark", name: t("Geistesblitz"), about: t("Spiele einen brillanten Zug."), stat: "brilliants", goal: 1, proof: true },
  { id: "clean-work", tier: "uncommon", icon: "check", name: t("Saubere Arbeit"), about: t("Erreiche in einer Partie (mind. 20 Züge) 90 % Genauigkeit."), stat: "best_accuracy", goal: 90, proof: true, unit: "pct" },
  { id: "flawless", tier: "uncommon", icon: "shield", name: t("Makellos"), about: t("Spiele eine Partie (mind. 20 Züge) ohne Ungenauigkeit, Fehler oder Patzer."), stat: "clean_games", goal: 1, proof: true },
  { id: "all-rounder", tier: "uncommon", icon: "globe", name: t("Allrounder"), about: t("Gewinne in 3 verschiedenen Bedenkzeiten."), stat: "speeds_won", goal: 3 },
  { id: "little-giant", tier: "uncommon", icon: "rise", name: t("Kleiner Riese"), about: t("Besiege einen Gegner, der mindestens 100 Wertungspunkte stärker war."), stat: "max_beaten_gap", goal: 100, proof: true },
  { id: "wild-start", tier: "uncommon", icon: "board", name: t("Wilder Start"), about: t("Spiele eine Chess960-Partie."), stat: "chess960_games", goal: 1, proof: true },
  { id: "night-owl", tier: "uncommon", icon: "moon", name: t("Nachteule"), about: t("Spiele eine Partie zwischen Mitternacht und 5 Uhr."), stat: "night_games", goal: 1, quirky: true, proof: true },
  { id: "early-bird", tier: "uncommon", icon: "sun", name: t("Der frühe Vogel"), about: t("Spiele eine Partie zwischen 5 und 7 Uhr morgens."), stat: "early_games", goal: 1, quirky: true, proof: true },
  { id: "in-passing", tier: "uncommon", icon: "pawn", name: t("Im Vorbeigehen"), about: t("Schlage einen Bauern en passant."), stat: "en_passants", goal: 1, quirky: true, proof: true },
  { id: "check-storm", tier: "uncommon", icon: "bolt", name: t("Schachgewitter"), about: t("Gib in einer Partie mindestens 8 Mal Schach."), stat: "max_checks", goal: 8, proof: true },
  { id: "knight-mate", tier: "uncommon", icon: "knight", name: t("Springer-Matt"), about: t("Setze mit einem Springer matt."), stat: "mate_knight", goal: 1, proof: true },
  { id: "bishop-mate", tier: "uncommon", icon: "crown", name: t("Läufer-Matt"), about: t("Setze mit einem Läufer matt."), stat: "mate_bishop", goal: 1, proof: true },
  { id: "board-fever", tier: "uncommon", icon: "calendar", name: t("Brettfieber"), about: t("Spiele 10 Partien an einem Tag."), stat: "best_day_games", goal: 10 },
  { id: "globetrotter", tier: "uncommon", icon: "globe", name: t("Weltenbummler"), about: t("Spiele auf Lichess und auf Chess.com."), stat: "platforms", goal: 2 },
  { id: "duel-won", tier: "uncommon", icon: "swords", name: t("Duell gewonnen"), about: t("Besiege einen deiner Freunde."), stat: "rival_wins", goal: 1, proof: true },
  { id: "worn-down", tier: "uncommon", icon: "swords", name: t("Zermürbt"), about: t("Bringe 25 Gegner zur Aufgabe."), stat: "resign_wins", goal: 25 },
  { id: "four-digits", tier: "uncommon", icon: "gauge", name: t("Vierstellig"), about: t("Erreiche in einem Zeitformat eine Wertung von 1000."), stat: "peak_rating", goal: 1000 },
  { id: "stalemate", tier: "uncommon", icon: "shield", name: t("Patt!"), about: t("Beende eine Partie mit einem Patt."), stat: "stalemate_draws", goal: 1, quirky: true, proof: true },
  { id: "deja-vu", tier: "uncommon", icon: "reset", name: t("Déjà-vu"), about: t("Beende eine Partie durch dreifache Stellungswiederholung."), stat: "repetition_draws", goal: 1, quirky: true, proof: true },
  { id: "knight-hopper", tier: "uncommon", icon: "knight", name: t("Rösselsprung"), about: t("Ziehe in einer Partie 12 Mal mit dem Springer."), stat: "max_knight_moves", goal: 12, quirky: true, proof: true },
  { id: "gambit-fan", tier: "uncommon", icon: "openings", name: t("Gambit-Fan"), about: t("Spiele 10 Partien mit einem Gambit."), stat: "gambit_games", goal: 10 },
  { id: "regular-customer", tier: "uncommon", icon: "swords", name: t("Stammkunde"), about: t("Besiege denselben Gegner 5 Mal."), stat: "max_wins_one_opponent", goal: 5, quirky: true },
  { id: "bloodbath", tier: "uncommon", icon: "swords", name: t("Gemetzel"), about: t("Schlage in einer Partie mindestens 20 Mal."), stat: "max_captures", goal: 20, quirky: true, proof: true },
  { id: "signature-opening", tier: "uncommon", icon: "openings", name: t("Lieblingseröffnung"), about: t("Spiele 25 Partien mit derselben Eröffnung."), stat: "max_opening_games", goal: 25 },
  { id: "fireworks", tier: "uncommon", icon: "skull", name: t("Feuerwerk"), about: t("Spiele 5 Patzer in einer einzigen Partie."), stat: "max_blunders_game", goal: 5, quirky: true, proof: true },
  { id: "grob-moment", tier: "uncommon", icon: "pawn", name: t("Der Grob-Moment"), about: t("Eröffne mit 1.g4."), stat: "grob_games", goal: 1, quirky: true, secret: true, proof: true },
  { id: "orangutan", tier: "uncommon", icon: "pawn", name: t("Orang-Utan"), about: t("Eröffne mit 1.b4."), stat: "polish_games", goal: 1, quirky: true, proof: true },
  { id: "holiday-moves", tier: "uncommon", icon: "calendar", name: t("Bescherung am Brett"), about: t("Spiele am 24., 25., 26. oder 31. Dezember oder am 1. Januar."), stat: "holiday_games", goal: 1, quirky: true, proof: true },
  { id: "back-on-feet", tier: "uncommon", icon: "rise", name: t("Aufgerappelt"), about: t("Gewinne direkt nach drei Niederlagen in Folge."), stat: "rebound", goal: 1, quirky: true },
  { id: "rough-patch", tier: "uncommon", icon: "skull", name: t("Durchhalter"), about: t("Verliere 5 Partien in Folge und spiel trotzdem weiter."), stat: "loss_streak", goal: 5, quirky: true },
  { id: "machine-smasher", tier: "uncommon", icon: "cpu", name: t("Maschinensturm"), about: t("Besiege einen Computergegner."), stat: "bot_wins", goal: 1, quirky: true, proof: true },
  { id: "board-veteran", tier: "rare", icon: "games", name: t("Brettveteran"), about: t("Spiele 500 Partien."), stat: "games", goal: 500 },
  { id: "hundred-wins", tier: "rare", icon: "star", name: t("Hundert Siege"), about: t("Gewinne 100 Partien."), stat: "wins", goal: 100 },
  { id: "unstoppable", tier: "rare", icon: "flame", name: t("Unaufhaltsam"), about: t("Gewinne 8 Partien in Folge."), stat: "win_streak", goal: 8 },
  { id: "two-weeks", tier: "rare", icon: "calendar", name: t("Zwei Wochen am Brett"), about: t("Spiele an 14 Tagen hintereinander."), stat: "day_streak", goal: 14 },
  { id: "thorough", tier: "rare", icon: "cpu", name: t("Gründlich"), about: t("Lass 100 Partien analysieren."), stat: "analyzed", goal: 100 },
  { id: "shower-of-sparks", tier: "rare", icon: "spark", name: t("Funkenregen"), about: t("Spiele 10 brillante Züge."), stat: "brilliants", goal: 10 },
  { id: "almost-machine", tier: "rare", icon: "check", name: t("Fast eine Maschine"), about: t("Erreiche in einer Partie (mind. 20 Züge) 95 % Genauigkeit."), stat: "best_accuracy", goal: 95, proof: true, unit: "pct" },
  { id: "flawless-five", tier: "rare", icon: "shield", name: t("Fünfmal makellos"), about: t("Spiele 5 makellose Partien (mind. 20 Züge)."), stat: "clean_games", goal: 5 },
  { id: "steady-stand", tier: "rare", icon: "shield", name: t("Sicherer Stand"), about: t("Spiele 10 analysierte Partien in Folge ohne Patzer (mind. 10 Züge)."), stat: "blunder_free_streak", goal: 10 },
  { id: "risen-again", tier: "rare", icon: "rise", name: t("Auferstanden"), about: t("Gewinne eine Partie, in der deine Gewinnchance zwischenzeitlich unter 10 % lag."), stat: "lowest_wp_win", goal: 10, below: true, proof: true, unit: "pct" },
  { id: "davids-sling", tier: "rare", icon: "rise", name: t("Davids Schleuder"), about: t("Besiege einen Gegner, der mindestens 200 Wertungspunkte stärker war."), stat: "max_beaten_gap", goal: 200, proof: true },
  { id: "mate-master", tier: "rare", icon: "crown", name: t("Mattmeister"), about: t("Setze 50 Mal matt."), stat: "mates", goal: 50 },
  { id: "blitz-storm", tier: "rare", icon: "bolt", name: t("Blitzgewitter"), about: t("Gewinne 100 Blitzpartien."), stat: "blitz_wins", goal: 100 },
  { id: "patient-player", tier: "rare", icon: "timer", name: t("Geduldsspieler"), about: t("Gewinne 50 Schnellschachpartien."), stat: "rapid_wins", goal: 50 },
  { id: "rapid-fire", tier: "rare", icon: "bolt", name: t("Schnellfeuer"), about: t("Gewinne 50 Bullet-Partien."), stat: "bullet_wins", goal: 50 },
  { id: "night-shift", tier: "rare", icon: "moon", name: t("Nachtschicht"), about: t("Spiele 25 Partien zwischen Mitternacht und 5 Uhr."), stat: "night_games", goal: 25, quirky: true },
  { id: "last-second", tier: "rare", icon: "hourglass", name: t("Auf den letzten Drücker"), about: t("Gewinne eine Partie mit höchstens 3 Sekunden auf der Uhr."), stat: "min_time_left_win", goal: 3, below: true, quirky: true, proof: true, unit: "sec" },
  { id: "watchmaker", tier: "rare", icon: "hourglass", name: t("Uhrmacher"), about: t("Gewinne 25 Partien auf Zeit."), stat: "timeout_wins", goal: 25 },
  { id: "marathon", tier: "rare", icon: "timer", name: t("Marathon"), about: t("Spiele eine Partie mit mehr als 100 Zügen."), stat: "max_game_plies", goal: 200, proof: true },
  { id: "short-work", tier: "rare", icon: "bolt", name: t("Kurzer Prozess"), about: t("Gewinne eine Partie in höchstens 10 Zügen."), stat: "min_win_plies", goal: 20, below: true, proof: true },
  { id: "scholars-mate", tier: "rare", icon: "crown", name: t("Schäfermatt"), about: t("Setze in höchstens 4 Zügen mit der Dame auf f7 (oder f2) matt."), stat: "scholars_mates", goal: 1, quirky: true, proof: true },
  { id: "snatching-defeat", tier: "rare", icon: "skull", name: t("Aus dem Gewinn gepatzt"), about: t("Verliere eine Partie, in der du bei mindestens 95 % Gewinnchance standest."), stat: "highest_wp_lost", goal: 95, quirky: true, secret: true, proof: true, unit: "pct" },
  { id: "kings-stroll", tier: "rare", icon: "crown", name: t("Königsspaziergang"), about: t("Ziehe in einer Partie 12 Mal mit dem König."), stat: "max_king_moves", goal: 12, quirky: true, proof: true },
  { id: "chaos-champion", tier: "rare", icon: "skull", name: t("Chaos-Sieger"), about: t("Gewinne eine Partie trotz mindestens 5 Patzern."), stat: "chaos_wins", goal: 1, quirky: true, proof: true },
  { id: "friend-group-terror", tier: "rare", icon: "swords", name: t("Schrecken des Freundeskreises"), about: t("Besiege 3 verschiedene Freunde."), stat: "rivals_beaten", goal: 3 },
  { id: "nemesis", tier: "rare", icon: "swords", name: t("Angstgegner"), about: t("Besiege denselben Freund 5 Mal."), stat: "max_wins_one_rival", goal: 5, quirky: true },
  { id: "friday-13", tier: "rare", icon: "star", name: t("Pech? Nicht heute!"), about: t("Gewinne eine Partie an einem Freitag, dem 13."), stat: "friday13_wins", goal: 1, quirky: true, proof: true },
  { id: "perfect-day", tier: "rare", icon: "star", name: t("Perfekter Tag"), about: t("Gewinne an einem Tag 5 Partien, ohne an diesem Tag zu verlieren."), stat: "perfect_day", goal: 5 },
  { id: "deep-thinker", tier: "rare", icon: "timer", name: t("Dauergrübler"), about: t("Denke 10 Minuten über einen einzigen Zug nach."), stat: "max_think", goal: 600, quirky: true, proof: true, unit: "sec" },
  { id: "pawn-mate", tier: "rare", icon: "pawn", name: t("Bauern-Matt"), about: t("Setze mit einem Bauern (ohne Umwandlung) matt."), stat: "mate_pawn", goal: 1, proof: true },
  { id: "bongcloud", tier: "rare", icon: "crown", name: t("Bongcloud-Botschafter"), about: t("Spiele den Bongcloud: König auf e2 im zweiten Zug (mit Schwarz auf e7)."), stat: "bongcloud_games", goal: 1, quirky: true, secret: true, proof: true },
  { id: "opening-collector", tier: "rare", icon: "openings", name: t("Eröffnungs-Sammler"), about: t("Spiele 20 verschiedene Eröffnungen."), stat: "openings_distinct", goal: 20 },
  { id: "vereinsniveau", tier: "rare", icon: "gauge", name: t("Vereinsniveau"), about: t("Erreiche in einem Zeitformat eine Wertung von 1400."), stat: "peak_rating", goal: 1400 },
  { id: "beat-1800", tier: "rare", icon: "trophy", name: t("Hochkarätig"), about: t("Besiege einen Gegner mit Wertung 1800 oder höher."), stat: "max_beaten_rating", goal: 1800, proof: true },
  { id: "thousand-games", tier: "epic", icon: "games", name: t("Tausendsassa"), about: t("Spiele 1000 Partien."), stat: "games", goal: 1000 },
  { id: "wins-500", tier: "epic", icon: "star", name: t("Fünfhundert Siege"), about: t("Gewinne 500 Partien."), stat: "wins", goal: 500 },
  { id: "victory-rush", tier: "epic", icon: "flame", name: t("Siegesrausch"), about: t("Gewinne 12 Partien in Folge."), stat: "win_streak", goal: 12 },
  { id: "month-runner", tier: "epic", icon: "calendar", name: t("Monatsläufer"), about: t("Spiele an 30 Tagen hintereinander."), stat: "day_streak", goal: 30 },
  { id: "hundred-days", tier: "epic", icon: "calendar", name: t("Hundert Tage"), about: t("Spiele an 100 verschiedenen Tagen."), stat: "days_active", goal: 100 },
  { id: "archivist", tier: "epic", icon: "cpu", name: t("Archivar"), about: t("Lass 500 Partien analysieren."), stat: "analyzed", goal: 500 },
  { id: "brilliance-collector", tier: "epic", icon: "spark", name: t("Brillanz-Sammler"), about: t("Spiele 25 brillante Züge."), stat: "brilliants", goal: 25 },
  { id: "double-brilliance", tier: "epic", icon: "spark", name: t("Doppelte Brillanz"), about: t("Spiele 2 brillante Züge in derselben Partie."), stat: "max_brilliants_game", goal: 2, proof: true },
  { id: "nearly-perfect", tier: "epic", icon: "check", name: t("Fast perfekt"), about: t("Erreiche in einer Partie (mind. 20 Züge) 98 % Genauigkeit."), stat: "best_accuracy", goal: 98, proof: true, unit: "pct" },
  { id: "purity-standard", tier: "epic", icon: "shield", name: t("Reinheitsgebot"), about: t("Spiele 25 makellose Partien (mind. 20 Züge)."), stat: "clean_games", goal: 25 },
  { id: "rock-solid", tier: "epic", icon: "shield", name: t("Felsenfest"), about: t("Spiele 25 analysierte Partien in Folge ohne Patzer (mind. 10 Züge)."), stat: "blunder_free_streak", goal: 25 },
  { id: "like-a-miracle", tier: "epic", icon: "rise", name: t("Wie durch ein Wunder"), about: t("Gewinne eine Partie, in der deine Gewinnchance zwischenzeitlich unter 3 % lag."), stat: "lowest_wp_win", goal: 3, below: true, proof: true, unit: "pct" },
  { id: "fall-of-the-titan", tier: "epic", icon: "rise", name: t("Titanensturz"), about: t("Besiege einen Gegner, der mindestens 400 Wertungspunkte stärker war."), stat: "max_beaten_gap", goal: 400, proof: true },
  { id: "promotion-mate", tier: "epic", icon: "pawn", name: t("Umwandlungs-Matt"), about: t("Setze matt, indem du einen Bauern umwandelst."), stat: "promo_mates", goal: 1, proof: true },
  { id: "underpromotion", tier: "epic", icon: "knight", name: t("Unterverwandlung"), about: t("Wandle einen Bauern in Springer, Läufer oder Turm um."), stat: "under_promotions", goal: 1, quirky: true, secret: true, proof: true },
  { id: "queen-factory", tier: "epic", icon: "crown", name: t("Damenfabrik"), about: t("Wandle in einer Partie 3 Bauern um."), stat: "max_promotions_game", goal: 3, quirky: true, proof: true },
  { id: "non-stop", tier: "epic", icon: "calendar", name: t("Dauerbrenner"), about: t("Spiele 30 Partien an einem Tag."), stat: "best_day_games", goal: 30, quirky: true },
  { id: "ten-in-a-day", tier: "epic", icon: "star", name: t("Zehn an einem Tag"), about: t("Gewinne 10 Partien an einem Tag."), stat: "best_day_wins", goal: 10 },
  { id: "tournament-strong", tier: "epic", icon: "gauge", name: t("Turnierstark"), about: t("Erreiche in einem Zeitformat eine Wertung von 1800."), stat: "peak_rating", goal: 1800 },
  { id: "table-champion", tier: "epic", icon: "swords", name: t("Stammtisch-Champion"), about: t("Besiege deine Freunde insgesamt 25 Mal."), stat: "rival_wins", goal: 25 },
  { id: "giant-slayer", tier: "epic", icon: "trophy", name: t("Riesentöter"), about: t("Besiege einen Gegner mit Wertung 2000 oder höher."), stat: "max_beaten_rating", goal: 2000, proof: true },
  { id: "engine-suspect", tier: "epic", icon: "check", name: t("Maschinenverdacht"), about: t("Erreiche in 5 Partien (je mind. 20 Züge) 95 % Genauigkeit."), stat: "acc95_games", goal: 5 },
  { id: "time-traveller", tier: "epic", icon: "globe", name: t("Zeitreisender"), about: t("Gewinne in 4 verschiedenen Bedenkzeiten."), stat: "speeds_won", goal: 4 },
  { id: "board-legend", tier: "legendary", icon: "games", name: t("Brett-Legende"), about: t("Spiele 5000 Partien."), stat: "games", goal: 5000 },
  { id: "wins-2000", tier: "legendary", icon: "star", name: t("Zweitausend Siege"), about: t("Gewinne 2000 Partien."), stat: "wins", goal: 2000 },
  { id: "invincible", tier: "legendary", icon: "flame", name: t("Unbesiegbar"), about: t("Gewinne 20 Partien in Folge."), stat: "win_streak", goal: 20 },
  { id: "hundred-day-streak", tier: "legendary", icon: "calendar", name: t("Hundert Tage in Folge"), about: t("Spiele an 100 Tagen hintereinander."), stat: "day_streak", goal: 100 },
  { id: "year-at-the-board", tier: "legendary", icon: "calendar", name: t("Ein Jahr am Brett"), about: t("Spiele an 365 verschiedenen Tagen."), stat: "days_active", goal: 365 },
  { id: "smothered-mate", tier: "legendary", icon: "knight", name: t("Ersticktes Matt"), about: t("Setze mit einem Springer matt, während der gegnerische König von eigenen Figuren eingeschlossen ist."), stat: "smothered_mates", goal: 1, secret: true, proof: true },
  { id: "castling-mate", tier: "legendary", icon: "crown", name: t("Rochade-Matt"), about: t("Setze mit der Rochade matt."), stat: "castle_mates", goal: 1, secret: true, proof: true },
  { id: "brilliance-factory", tier: "legendary", icon: "spark", name: t("Brillanz-Fabrik"), about: t("Spiele 100 brillante Züge."), stat: "brilliants", goal: 100 },
  { id: "triple-brilliance", tier: "legendary", icon: "spark", name: t("Dreifache Brillanz"), about: t("Spiele 3 brillante Züge in derselben Partie."), stat: "max_brilliants_game", goal: 3, proof: true },
  { id: "perfection", tier: "legendary", icon: "check", name: t("Perfektion"), about: t("Erreiche in einer Partie (mind. 20 Züge) 99 % Genauigkeit."), stat: "best_accuracy", goal: 99, proof: true, unit: "pct" },
  { id: "kingslayer", tier: "legendary", icon: "crown", name: t("Königsmörder"), about: t("Besiege einen Spieler mit dem Titel Großmeister (GM)."), stat: "beat_gm", goal: 1, proof: true },
  { id: "master-beater", tier: "legendary", icon: "trophy", name: t("Meisterbezwinger"), about: t("Besiege einen Gegner mit Wertung 2400 oder höher."), stat: "max_beaten_rating", goal: 2400, proof: true },
  { id: "master-class", tier: "legendary", icon: "gauge", name: t("Meisterklasse"), about: t("Erreiche in einem Zeitformat eine Wertung von 2200."), stat: "peak_rating", goal: 2200 },
  { id: "resurrection", tier: "legendary", icon: "rise", name: t("Auferstehung"), about: t("Gewinne eine Partie, in der deine Gewinnchance zwischenzeitlich unter 1 % lag."), stat: "lowest_wp_win", goal: 1, below: true, secret: true, proof: true, unit: "pct" },
  { id: "time-lord", tier: "legendary", icon: "globe", name: t("Zeitherrscher"), about: t("Gewinne in 5 verschiedenen Bedenkzeiten."), stat: "speeds_won", goal: 5 },
  { id: "fools-mate", tier: "legendary", icon: "skull", name: t("Narrenmatt"), about: t("Gewinne mit Schwarz in nur 2 Zügen (Narrenmatt)."), stat: "fool_mates", goal: 1, quirky: true, secret: true, proof: true },
];
