// Waiting text for engine work. The engine's neural network (about 76 MB) is
// downloaded once per device on first use; on a slow connection that takes
// longer than the search itself, so the text says what is going on.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { ENGINE_NAME } from "../engine/info";
import { getEngineLoad, onEngineLoad, type EngineLoad } from "../engine/uci";

export function useEngineLoad(): EngineLoad {
  const [load, setLoad] = useState(getEngineLoad);
  useEffect(() => {
    setLoad(getEngineLoad());
    return onEngineLoad(setLoad);
  }, []);
  return load;
}

/** "Engine wird einmalig geladen (43 %) …" while the network downloads, else null. */
export function engineLoadText(load: EngineLoad): string | null {
  if (load.state === "failed") return `${ENGINE_NAME} konnte nicht geladen werden. Bitte prüfe die Internetverbindung.`;
  if (load.state !== "loading") return null;
  const percent = load.total > 0 ? ` (${Math.min(99, Math.floor((load.loaded / load.total) * 100))} %)` : "";
  return `${ENGINE_NAME} wird einmalig geladen${percent} …`;
}

/** `children` (e.g. "Caissa rechnet …"), replaced by the download state while the engine is not there yet. */
export function EngineWait({ children }: { children: ComponentChildren }) {
  const text = engineLoadText(useEngineLoad());
  return <>{text ?? children}</>;
}
