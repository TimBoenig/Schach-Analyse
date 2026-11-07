// Without a boundary, one exception while rendering (for example a chart
// tooltip reading data that changed under the mouse) unmounts the whole app and
// leaves only the grey page background. The boundary keeps navigation alive and
// shows what went wrong instead.
import { Component, type ComponentChildren } from "preact";

import { CoachAvatar } from "./Coach";

interface Props {
  children: ComponentChildren;
  /** Short name of the area, shown in the message ("Diese Seite", "Das Menü"). */
  area?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown): void {
    console.error("Darstellungsfehler", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div class="crash card" role="alert">
        <CoachAvatar mood="sad" size={72} />
        <h3>{this.props.area ?? "Diese Seite"} konnte nicht angezeigt werden</h3>
        <p class="muted">
          Deine Partien und Analysen sind sicher gespeichert. Versuch es noch einmal oder lade die App neu. Wenn es wieder
          passiert, hilft ein Screenshot dieser Meldung bei der Fehlersuche.
        </p>
        <pre class="crash-detail">{error.message || String(error)}</pre>
        <div class="row" style={{ justifyContent: "center" }}>
          <button class="btn primary" onClick={() => this.setState({ error: null })}>
            Nochmal versuchen
          </button>
          <button class="btn" onClick={() => location.reload()}>
            App neu laden
          </button>
        </div>
      </div>
    );
  }
}
