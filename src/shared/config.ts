export const APP_NAME = "CAS Flight Simulator";

export const THEATER = Object.freeze({
  // Neutral demonstration region. This is a project default, not user location data.
  centerLongitudeDeg: 138.7274,
  centerLatitudeDeg: 35.3606,
  initialCameraHeightM: 42_000,
  widthKm: 50,
  heightKm: 50,
  warningBandKm: 5,
});

export const C2_RESOURCE_BUDGET = Object.freeze({
  targetFps: 45,
  minimumFps: 30,
  benchmarkMinutes: 30,
  targetTransferMiBPerPlayerSession: 150,
  resourceTimingBufferSize: 6_000,
});

// Kept temporarily for any C0-era imports while C2 becomes the canonical owner.
export const C0_RESOURCE_BUDGET = C2_RESOURCE_BUDGET;
