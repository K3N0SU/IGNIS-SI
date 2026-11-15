/** Top-level views. Add an entry here to add a tab to the top bar. */
export const VIEWS = [
  { key: "workbench", label: "Workbench", path: "/" },
  { key: "analytics", label: "Analytics", path: "/analytics" },
  { key: "flight", label: "Flight data", path: "/flight" },
] as const;

export type View = (typeof VIEWS)[number]["key"];
