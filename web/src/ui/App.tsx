import { useEffect, useState } from "preact/hooks";

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
    run();
    const sb = supabase();
    const sub = sb?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") run();
    });
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const timer = window.setInterval(run, 2 * 60 * 1000);
    return () => {
      sub?.data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.clearInterval(timer);
    };
  }, []);
}

export function App() {
  const route = useRoute();
  const [lastGame, setLastGame] = useState<string | null>(null);
  useBackgroundSync();

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
