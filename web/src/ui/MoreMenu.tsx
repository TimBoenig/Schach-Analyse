// The three-dot menu of the phone layout: rarely needed actions live behind
// one button instead of a row of icons that eats the screen.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { IconMore } from "./icons";

export interface MenuItem {
  label: string;
  icon?: ComponentChildren;
  /** A switch: shows a tick while on. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** A thin line above this entry. */
  divider?: boolean;
  onSelect: () => void;
}

export function MoreMenu({ items, label = "Mehr", class: cls = "" }: { items: (MenuItem | false | null | undefined)[]; label?: string; class?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const shown = items.filter(Boolean) as MenuItem[];
  return (
    <div class={`more-menu ${cls}`} ref={root}>
      <button class={`btn icon ghost more-btn${open ? " on" : ""}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <IconMore />
      </button>
      {open && (
        <div class="more-pop" role="menu">
          {shown.map((it) => (
            <button
              key={it.label}
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              disabled={it.disabled}
              class={`more-item${it.danger ? " danger" : ""}${it.divider ? " divider" : ""}`}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <span class="more-icon">{it.icon}</span>
              <span class="more-label">{it.label}</span>
              {it.checked !== undefined && <span class={`more-tick${it.checked ? " on" : ""}`} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
