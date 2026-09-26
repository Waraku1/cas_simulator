// A small visual clearance for the game's aircraft center over rendered terrain.
export const GAME_GROUND_CLEARANCE_M = 5;

export function gameGroundContact(altitudeM, groundHeightM) {
  return Number.isFinite(altitudeM)
    && Number.isFinite(groundHeightM)
    && altitudeM <= Math.max(0, groundHeightM) + GAME_GROUND_CLEARANCE_M;
}
