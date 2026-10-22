// Minimal stroke icons (24px grid) so the app needs no icon font.
const base = { fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", viewBox: "0 0 24 24" } as const;

export const IconHome = () => (
  <svg {...base}><path d="M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" /></svg>
);
export const IconGames = () => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></svg>
);
export const IconBoard = () => (
  <svg {...base}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>
);
export const IconProfile = () => (
  <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>
);
export const IconTraining = () => (
  <svg {...base}><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" /></svg>
);
export const IconSettings = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const IconFirst = () => (<svg {...base}><path d="M18 18l-6-6 6-6M8 6v12" /></svg>);
export const IconPrev = () => (<svg {...base}><path d="M15 18l-6-6 6-6" /></svg>);
export const IconNext = () => (<svg {...base}><path d="M9 18l6-6-6-6" /></svg>);
export const IconLast = () => (<svg {...base}><path d="M6 18l6-6-6-6M16 6v12" /></svg>);
export const IconFlip = () => (<svg {...base}><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>);
export const IconPlus = () => (<svg {...base}><path d="M12 5v14M5 12h14" /></svg>);
export const IconPlay = () => (<svg {...base}><path d="M7 4l13 8-13 8z" /></svg>);
export const IconStop = () => (<svg {...base}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>);
export const IconTrash = () => (<svg {...base}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>);
export const IconSync = () => (<svg {...base}><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4" /></svg>);
export const IconBack = () => (<svg {...base}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>);
export const IconSpark = () => (<svg {...base}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>);
export const IconInsights = () => (<svg {...base}><path d="M3 20h18M6 16v-5M10 16V7M14 16v-3M18 16V4" /></svg>);
export const IconSearch = () => (<svg {...base}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>);
export const IconKeyboard = () => (<svg {...base}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>);
export const IconOpenings = () => (<svg {...base}><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2z" /></svg>);
