// The public name and address of the site. One place, so a rename never has to
// hunt through the views again. Storage keys (IndexedDB name, backup format,
// localStorage) deliberately keep their old "schach" ids: renaming them would
// cut existing users off from their saved games.
export const BRAND = "EndGameKing";
export const BRAND_DOMAIN = "endgameking.com";
export const SITE_URL = `https://${BRAND_DOMAIN}`;
/** Prefix of downloaded files (backup, CSV, PGN, AI export). */
export const FILE_PREFIX = "endgameking";
