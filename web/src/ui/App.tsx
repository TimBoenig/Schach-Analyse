import { useEffect, useState } from "preact/hooks";

import { subscribeQueue } from "../app/analysisService";
import { syncAvailable, syncNow, supabase } from "../storage/sync";
import { AnalysisView } from "./AnalysisView";
import { GamesView } from "./GamesView";
import { IconBoard, IconGames, IconProfile, IconSettings, IconTraining } from "./icons";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { TrainingView } from "./TrainingView";
import { useRoute, navigate, type Route } from "./router";

const NAV: { view: Route["view"]; label: string; icon: () => preact.JSX.Element }[] = [
  { view: "games", label: "Partien", icon: IconGames },
  { view: "analysis", label: "Analyse", icon: IconBoard },
  { view: "profile", label: "Profil", icon: IconProfile },
  { view: "training", label: "Training", icon: IconTraining },
  { view: "settings", label: "Einstellungen", icon: IconSettings },
];

function useBackgroundSync(): void {
  useEffect(() => {
    if (!syncAvailable()) return;
    const run = () => void syncNow().catch(() => undefined);
    // Let the first screen render before the sync client loads.
    const first = window.setTimeout(run, 1200);
    let unsubscribe: (() => void) | null = null;
    let alive = true;
    void supabase()?.then((sb) => {
      if (!alive) return;
      const sub = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") run();
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    });
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const timer = window.setInterval(run, 2 * 60 * 1000);
    return () => {
      alive = false;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);
}

export function App() {
  const route = useRoute();
  const [lastGame, setLastGame] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  useBackgroundSync();
  useEffect(() => subscribeQueue((q) => setAnalysing(Boolean(q.current) || q.queued.length > 0)), []);

  useEffect(() => {
    if (route.view === "analysis" && route.gameId) setLastGame(route.gameId);
  }, [route]);

  return (
    <div class="app">
      <nav class="nav">
        <img class="nav-logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        {NAV.map((n) => (
          <button
            key={n.view}
            class={route.view === n.view ? "active" : ""}
            onClick={() => navigate(n.view === "analysis" ? { view: "analysis", gameId: lastGame ?? undefined } : { view: n.view })}
          >
            {n.view === "games" && analysing && <span class="nav-status" title="Analyse läuft" />}
            <n.icon />
            {n.label}
          </button>
        ))}
        <div class="nav-spacer" />
      </nav>
      <main class="main">
        {route.view === "games" && <GamesView />}
        {route.view === "analysis" && <AnalysisView gameId={route.gameId} ply={route.ply} />}
        {route.view === "profile" && <ProfileView />}
        {route.view === "training" && <TrainingView />}
        {route.view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
