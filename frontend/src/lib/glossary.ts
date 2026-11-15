/** Plain-language explanations for the jargon a first-time user meets. */
export const GLOSSARY = {
  coolFlame:
    "A low-temperature flame near 700 K. It gives off almost no visible light, so a colour camera shows a dark chamber while fuel keeps burning and carbon monoxide builds up.",
  hotFlame: "The ordinary visible flame, around 1,500 to 2,000 K.",
  radiativeExtinction:
    "The flame grows until it radiates heat away faster than it makes it, then goes out on its own. This only happens to large flames in microgravity.",
  damkohler:
    "Damkohler number: how fast the chemistry runs compared with how fast heat and fuel are carried away. Above 1 the flame sustains itself; below 1 it goes out.",
  uv: "Excited OH molecules emit ultraviolet light at 310 nm. An intensified UV camera picks up flames that are too dim for the eye, including cool flames.",
  ppo2: "Partial pressure of oxygen: oxygen fraction times cabin pressure. Crew need roughly 0.16 atm or more to breathe safely.",
  envelope:
    "The range of conditions that were actually tested in orbit. Inside it, the model is checked against flight data. Outside it, the model is extrapolating.",
  d2: "Droplet diameter squared. Under steady burning it falls in a straight line, and the slope is the burning rate.",
  burnRate: "Burning-rate constant K: how fast the droplet's diameter squared shrinks.",
  radiometer: "A sensor that measures total radiated heat reaching the chamber wall.",
  coRatio: "Ratio of carbon monoxide to oxygen near the flame. It rises while a cool flame burns because cool-flame chemistry is incomplete.",
  diluent: "The inert gas mixed with oxygen. Carbon dioxide and helium remove heat differently from nitrogen and change when a flame goes out.",
  limitingO2: "The lowest oxygen percentage at which the material still burns. A cabin above that level can sustain a fire on it.",
  eclss: "Environmental Control and Life Support System: the fans, gas supply and scrubbers that manage cabin air.",
  classifier:
    "A machine-learning model that names the fire state from the radiometer, UV and gas sensors. It never sees the camera image, so it can call a cool flame the camera misses.",
  ensemble: "The model is run several times with its calibration constants varied. If the runs disagree, the prediction is uncertain.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
