// Number and word helpers of the "Züge & Fehler" page.
import { t } from "../../i18n";


export const de = (v: number, digits = 1): string => v.toFixed(digits).replace(".", ",");

export const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

/** A rate per 100 moves: two digits below one (0,07 brilliant moves would read as 0,1), else one. */
export const rate = (v: number): string => de(v, v < 1 ? 2 : 1);

export const PHASE_SHORT: Record<string, string> = { opening: t("Eröffnung"), middlegame: t("Mittelspiel"), endgame: t("Endspiel") };
