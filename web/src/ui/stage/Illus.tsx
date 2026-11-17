// Small moving pictures of the app's areas for Lucena's tour. They show how
// a page is built, never numbers: everything about the user comes from their
// own games on the real pages.
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const badge = (name: string) => asset(`badges/${name}.svg`);

export type IllusKind = "engine" | "games" | "stats" | "training" | "players";

function Engine() {
  // An evaluation line that tips twice: the moments a report is built around.
  const line = "M0 78 C30 70 52 82 80 72 S118 40 150 46 S196 110 226 104 S276 60 300 64 S352 30 400 26";
  return (
    <div class="illus illus-curve">
      <div class="illus-bar m" />
      <svg viewBox="0 0 400 150" preserveAspectRatio="none" role="presentation">
        <line class="illus-curve-zero" x1="0" y1="75" x2="400" y2="75" />
        <path class="illus-curve-line" d={line} />
        <circle class="illus-curve-dot" cx="150" cy="46" r="6" fill="var(--win)" style={{ animationDelay: "1s" }} />
        <circle class="illus-curve-dot" cx="226" cy="104" r="6" fill="var(--loss)" style={{ animationDelay: "1.4s" }} />
        <circle class="illus-curve-dot" cx="400" cy="26" r="6" fill="var(--win)" style={{ animationDelay: "2s" }} />
      </svg>
      <div class="illus-curve-foot">
        {["brilliant", "best_v2", "inaccuracy", "mistake", "blunder"].map((b, i) => (
          <img key={b} src={badge(b)} alt="" style={{ animationDelay: `${1.2 + i * 0.14}s` }} />
        ))}
      </div>
    </div>
  );
}

const GAME_ROWS: { result: "w" | "l" | "d"; badges: string[] }[] = [
  { result: "w", badges: ["brilliant", "best_v2"] },
  { result: "l", badges: ["blunder"] },
  { result: "w", badges: ["great_find"] },
  { result: "d", badges: ["mistake", "inaccuracy"] },
];

function Games() {
  return (
    <div class="illus">
      {GAME_ROWS.map((g, i) => (
        <div class="illus-game" key={i}>
          <span class={`illus-dot ${g.result}`} />
          <div class="illus-lines">
            <div class={`illus-bar ${i % 2 ? "m" : "l"}`} />
            <div class="illus-bar s dim" />
          </div>
          <div class="illus-badges">
            {g.badges.map((b) => (
              <img key={b} src={badge(b)} alt="" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// A hexagon web and an uneven shape inside it, like the skills chart.
const hex = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(75 + r * Math.cos(a)).toFixed(1)},${(75 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
const SHAPE = [0.86, 0.6, 0.74, 0.42, 0.7, 0.92]
  .map((f, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(75 + 68 * f * Math.cos(a)).toFixed(1)},${(75 + 68 * f * Math.sin(a)).toFixed(1)}`;
  })
  .join(" ");

function Stats() {
  return (
    <div class="illus">
      <div class="illus-stats">
        <svg viewBox="0 0 150 150" role="presentation">
          {[68, 46, 24].map((r) => (
            <polygon key={r} class="illus-web" points={hex(r)} />
          ))}
          <polygon class="illus-shape" points={SHAPE} />
        </svg>
        <div class="illus-skill">
          {[
            ["82%", ""],
            ["64%", "mid"],
            ["71%", ""],
            ["38%", "bad"],
          ].map(([w, tone], i) => (
            <div class="illus-skill-row" key={i}>
              <div class="illus-bar" />
              <div class="illus-track">
                <span class={tone} style={{ width: w }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Training() {
  return (
    <div class="illus">
      <div class="illus-train">
        <div class="illus-board">
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} class={(Math.floor(i / 4) + i) % 2 ? "d" : ""} />
          ))}
          <img src={asset("pieces/black-king.svg")} alt="" style={{ left: "75%", top: "0%" }} />
          <img src={asset("pieces/black-pawn.svg")} alt="" style={{ left: "50%", top: "25%" }} />
          <img src={asset("pieces/black-pawn.svg")} alt="" style={{ left: "75%", top: "25%" }} />
          <img src={asset("pieces/white-rook.svg")} alt="" style={{ left: "0%", top: "75%" }} />
          <img src={asset("pieces/white-king.svg")} alt="" style={{ left: "50%", top: "75%" }} />
          <svg viewBox="0 0 100 100" role="presentation">
            <path class="illus-arrow" d="M12.5 80 L12.5 16" />
          </svg>
        </div>
        <div class="illus-steps">
          {[true, false, false].map((on, i) => (
            <div class="illus-step" key={i}>
              <span class={`illus-check${on ? " on" : ""}`} />
              <div class="illus-lines">
                <div class={`illus-bar ${["l", "m", "l"][i]}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Players() {
  const rows = [
    { tone: "var(--p0)", width: "88%", me: false },
    { tone: "var(--p1)", width: "66%", me: false },
    { tone: "var(--cta)", width: "72%", me: true },
    { tone: "var(--p2)", width: "48%", me: false },
  ];
  return (
    <div class="illus">
      <div class="illus-rank">
        {rows.map((r, i) => (
          <div class={`illus-rank-row${r.me ? " me" : ""}`} key={i} style={{ "--tone": r.tone }}>
            <span class="illus-avatar" />
            <div class="illus-bar" />
            <div class="illus-track">
              <span style={{ width: r.width }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Illus({ kind }: { kind: IllusKind }) {
  return (
    <div aria-hidden="true">
      {kind === "engine" && <Engine />}
      {kind === "games" && <Games />}
      {kind === "stats" && <Stats />}
      {kind === "training" && <Training />}
      {kind === "players" && <Players />}
    </div>
  );
}
