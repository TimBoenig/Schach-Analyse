// Entry of the hidden video studio. Its code (3D renderer, editor, export) is
// a separate chunk, fetched only when the studio is opened on an unlocked device.
import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";

import { navigate } from "../router";
import { adminVerify, hasAdminToken } from "../../app/adminApi";
import { AdminLogin } from "../admin/AdminLogin";
import "../admin/admin.css";
import { t } from "../../i18n";

let chunk: Promise<FunctionComponent> | null = null;
const load = () => (chunk ??= Promise.all([import("./StudioView"), import("./studio.css")]).then(([m]) => m.StudioView));

// The studio needs the admin password. A device that signed in recently is let
// in at once (the server confirms the token; offline, the unexpired token counts).
export function StudioRoute() {
  const [state, setState] = useState<"checking" | "locked" | "open">(hasAdminToken() ? "checking" : "locked");
  const [View, setView] = useState<FunctionComponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (state !== "checking") return;
    void adminVerify().then((v) => setState(v === "invalid" ? "locked" : "open"));
  }, [state]);
  useEffect(() => {
    if (state !== "open") return;
    load()
      .then((v) => setView(() => v))
      .catch(() => setFailed(true));
  }, [state]);
  if (state === "locked")
    return (
      <div class="studio-gate">
        <div class="card settings-card">
          <h3 style={{ marginTop: 0 }}>{t("Videostudio")}</h3>
          <AdminLogin hint={t("Das Studio ist mit dem Admin-Passwort geschützt.")} onDone={() => setState("open")} />
          <button class="btn ghost" style={{ marginTop: "10px" }} onClick={() => navigate({ view: "home" })}>
            {t("Zurück")}
          </button>
        </div>
      </div>
    );
  if (state === "checking") return <div class="studio-loading">{t("Studio wird geladen …")}</div>;
  if (failed) return <p style={{ padding: "40px" }}>{t("Das Studio konnte nicht geladen werden. Bist du offline?")}</p>;
  return View ? <View /> : <div class="studio-loading">{t("Studio wird geladen …")}</div>;
}
