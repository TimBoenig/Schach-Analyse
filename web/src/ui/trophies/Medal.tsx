// The round badge of a trophy: its icon in the colour of its tier.
import type { JSX } from "preact";

import type { Tier, TrophyIcon } from "../../domain/trophies";
import {
  IconBoard, IconBolt, IconCalendar, IconCheck, IconCpu, IconCrown, IconFlame, IconGames, IconGauge, IconGlobe, IconHourglass,
  IconKnight, IconLock, IconMoon, IconOpenings, IconPawn, IconReset, IconRise, IconShield, IconSkull, IconSpark, IconStar,
  IconSun, IconSwords, IconTimer, IconTrophy,
} from "../icons";

const ICONS: Record<TrophyIcon, () => JSX.Element> = {
  bolt: IconBolt, board: IconBoard, calendar: IconCalendar, check: IconCheck, cpu: IconCpu, crown: IconCrown, flame: IconFlame,
  games: IconGames, gauge: IconGauge, globe: IconGlobe, hourglass: IconHourglass, knight: IconKnight, moon: IconMoon,
  openings: IconOpenings, pawn: IconPawn, reset: IconReset, rise: IconRise, shield: IconShield, skull: IconSkull, spark: IconSpark,
  star: IconStar, sun: IconSun, swords: IconSwords, timer: IconTimer, trophy: IconTrophy,
};

export function Medal({ icon, tier, locked, secret, size = "md" }: { icon: TrophyIcon; tier: Tier; locked?: boolean; secret?: boolean; size?: "md" | "lg" }) {
  const Icon = secret && locked ? IconLock : ICONS[icon];
  return (
    <span class={`tr-medal tier-${tier} ${size}${locked ? " locked" : ""}`} aria-hidden="true">
      <span class="tr-medal-in">
        <Icon />
      </span>
    </span>
  );
}
