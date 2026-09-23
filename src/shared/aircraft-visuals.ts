import type { AircraftSpec } from "./product";

export type AircraftVisualSpec = Readonly<{
  appearanceKey: string;
  realAircraftName: string;
  manufacturer: string;
  modelUri: string;
  sourceName: string;
  sourcePage: string;
  license: "CC0";
  scale: number;
  minimumPixelSize: number;
  maximumScale: number;
  gltfOrientation: "standard";
  handlingProfileLabel: string;
}>;

const BELL_X1_VISUAL: AircraftVisualSpec = Object.freeze({
  appearanceKey: "bell-x1",
  realAircraftName: "Bell X-1",
  manufacturer: "Bell Aircraft Corp.",
  modelUri: "/aircraft/bell-x1.glb",
  sourceName: "Smithsonian Institution — National Air and Space Museum",
  sourcePage: "https://3d.si.edu/object/3d/6c69a6bb-55e6-4356-8725-120ff7f8d652",
  license: "CC0",
  scale: 1,
  minimumPixelSize: 28,
  maximumScale: 2.4,
  gltfOrientation: "standard",
  handlingProfileLabel: "CAS NORMALIZED HANDLING",
});

const VISUALS = new Map<string, AircraftVisualSpec>([
  [BELL_X1_VISUAL.appearanceKey, BELL_X1_VISUAL],
]);

export function aircraftVisualByAppearanceKey(appearanceKey: string) {
  return VISUALS.get(appearanceKey) ?? null;
}

export function aircraftVisualForSpec(aircraft: AircraftSpec | null | undefined) {
  return aircraft ? aircraftVisualByAppearanceKey(aircraft.appearanceKey) : null;
}

export { BELL_X1_VISUAL };
