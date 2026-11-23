// A closed row on a phone that opens into its content. The content is only
// built once opened, so heavy cards (boards, charts) cost nothing until wanted.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { IconChevron } from "./icons";

export function Fold({ title, sub, children, defaultOpen = false }: { title: string; sub?: ComponentChildren; children: ComponentChildren; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section class={`fold${open ? " open" : ""}`}>
      <button class="fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span class="fold-text">
          <strong>{title}</strong>
          {sub && <small>{sub}</small>}
        </span>
        <span class="fold-icon">
          <IconChevron />
        </span>
      </button>
      {open && <div class="fold-body">{children}</div>}
    </section>
  );
}
