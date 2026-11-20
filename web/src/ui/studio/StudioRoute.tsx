// Entry of the hidden video studio. Its code (3D renderer, editor, export) is
// a separate chunk, fetched only when the studio is opened on an unlocked device.
import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

import { navigate } from "../router";
import { studioUnlocked } from "./access";
import { t } from "../../i18n";

let chunk: Promise<FunctionComponent> | null = null;
const load = () => (chunk ??= Promise.all([import("./StudioView"), import("./studio.css")]).then(([m]) => m.StudioView));

export function StudioRoute() {
  const unlocked = studioUnlocked();
  const [View, setView] = useState<FunctionComponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!unlocked) {
      navigate({ view: "home" }, true);
      return;
    }
    load()
      .then((v) => setView(() => v))
      .catch(() => setFailed(true));
  }, [unlocked]);
  if (!unlocked) return null;
  if (failed) return <p style={{ padding: "40px" }}>{t("Das Studio konnte nicht geladen werden. Bist du offline?")}</p>;
  return View ? <View /> : <div class="studio-loading">{t("Studio wird geladen …")}</div>;
}
