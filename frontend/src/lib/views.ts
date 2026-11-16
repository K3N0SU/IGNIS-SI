/** Top-level views. Add an entry here to add a tab to the top bar. */
export const VIEWS = [
  {
    key: "workbench",
    label: "Workbench",
    path: "/",
    hint: "Set up a fire scenario and watch it play out: the chamber, the sensor readings, and how far to trust them.",
  },
  {
    key: "analytics",
    label: "Analytics",
    path: "/analytics",
    hint: "The bigger picture: which materials are riskiest, which conditions were tested, and how airflow and smoke behave.",
  },
  {
    key: "flight",
    label: "Flight data",
    path: "/flight",
    hint: "The real NASA measurements from the space station, and how closely the model matches them.",
  },
  {
    key: "how",
    label: "How it works",
    path: "/how",
    hint: "A one-page explanation of where the numbers come from and what each screen is for.",
  },
] as const;

export type View = (typeof VIEWS)[number]["key"];
