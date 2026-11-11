import { badgeFor } from "./labels";

/** Celebration over the board when the player finds a brilliant move: ring burst, sparks and the badge popping in. */
export function BrilliantFx({ square, flipped }: { square: string; flipped: boolean }) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = flipped ? 7 - file : file;
  const y = flipped ? rank : 7 - rank;
  return (
    <div class="brilliant-fx" aria-hidden="true">
      <div class="brilliant-flash" />
      <div class="brilliant-spot" style={{ left: `${(x + 0.5) * 12.5}%`, top: `${(y + 0.5) * 12.5}%` }}>
        <span class="brilliant-ring" />
        <span class="brilliant-ring r2" />
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} class="brilliant-spark" style={{ "--a": `${i * 30}deg`, "--d": `${i % 2 ? 0.08 : 0}s` }} />
        ))}
      </div>
      <div class="brilliant-banner">
        <img src={badgeFor("Brilliant") ?? ""} alt="" />
        <span>Brillant!!</span>
      </div>
    </div>
  );
}
