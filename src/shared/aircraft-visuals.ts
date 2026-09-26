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
  // Local model axes: nose/tail X, wings Y, height Z. The latter two
  // fictional variants reuse the licensed Bell X-1 geometry.
  proportions: readonly [number, number, number];
}>;

const BELL_X1_VISUAL: AircraftVisualSpec = Object.freeze({
  appearanceKey: "bell-x1",
  realAircraftName: "Bell X-1",
  manufacturer: "Bell Aircraft Corp.",
  modelUri: "/aircraft/bell-x1.glb",
  sourceName: "Smithsonian Institution — National Air and Space Museum",
  sourcePage: "https://3d.si.edu/object/3d/6c69a6bb-55e6-4356-8725-120ff7f8d652",
  license: "CC0",
  // The source GLB is physically normalized to 9.373 m. Match the visual
  // footprint of the former 18–22 m game silhouette at chase-camera range.
  scale: 2.2,
  minimumPixelSize: 72,
  maximumScale: 5,
  gltfOrientation: "standard",
  handlingProfileLabel: "CAS NORMALIZED HANDLING",
  proportions: [1, 1, 1] as const,
});

const BELL_X2_VISUAL: AircraftVisualSpec = Object.freeze({
  ...BELL_X1_VISUAL,
  appearanceKey: "bell-x2",
  realAircraftName: "Bell X-2",
  manufacturer: "CAS fictional variant",
  handlingProfileLabel: "CAS X-2 HANDLING",
  proportions: [1.16, 1.08, 0.94] as const,
});
const BELL_X3_VISUAL: AircraftVisualSpec = Object.freeze({
  ...BELL_X1_VISUAL,
  appearanceKey: "bell-x3",
  realAircraftName: "Bell X-3",
  manufacturer: "CAS fictional variant",
  handlingProfileLabel: "CAS X-3 HANDLING",
  proportions: [0.84, 0.90, 1.08] as const,
});

const VISUALS = new Map<string, AircraftVisualSpec>([
  [BELL_X1_VISUAL.appearanceKey, BELL_X1_VISUAL],
  [BELL_X2_VISUAL.appearanceKey, BELL_X2_VISUAL],
  [BELL_X3_VISUAL.appearanceKey, BELL_X3_VISUAL],
]);

export function aircraftVisualByAppearanceKey(appearanceKey: string) {
  return VISUALS.get(appearanceKey) ?? null;
}

export function aircraftVisualForSpec(aircraft: AircraftSpec | null | undefined) {
  // Free flight and unknown profiles use the reviewed base model.
  if (!aircraft) return BELL_X1_VISUAL;
  return aircraftVisualByAppearanceKey(aircraft.appearanceKey) ?? BELL_X1_VISUAL;
}

export { BELL_X1_VISUAL };
