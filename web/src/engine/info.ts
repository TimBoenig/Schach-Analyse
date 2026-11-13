// Which engine the app ships: one place for every text that names it.
// The build itself lives in web/engine/caissa (see its README).

/** Name shown to the user (waiting texts, settings, licences). */
export const ENGINE_NAME = "Caissa";
export const ENGINE_VERSION = "2.0";

/**
 * Caissa's neural network. Part of the file's address: a new network gets a new
 * address, so a copy kept by the browser or the service worker is never
 * mistaken for it.
 */
export const ENGINE_NET = "eval-ml-8-152B-spsa";
