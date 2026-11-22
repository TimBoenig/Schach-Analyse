// Worker entry: the profile code builds label tables with t() when it loads, so
// the worker first learns the page language (the first message), loads the
// English texts if needed and only then imports the real worker.
import { initLang, type Lang } from "../i18n";

const early: MessageEvent[] = [];
let started = false;

self.onmessage = (e: MessageEvent) => {
  if (!started && e.data?.kind === "lang") {
    started = true;
    void initLang(e.data.lang as Lang)
      .then(() => import("./profile.worker"))
      .then(() => {
        // profile.worker set its own handler; hand it what arrived meanwhile.
        for (const m of early.splice(0)) (self.onmessage as (ev: MessageEvent) => void)(m);
      });
    return;
  }
  early.push(e);
};
