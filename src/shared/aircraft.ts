import catalogJson from "./aircraft-catalog.json";
import type { AircraftSpec } from "./product";

export const AIRCRAFT_CATALOG = catalogJson as readonly AircraftSpec[];

const AIRCRAFT_BY_ID = new Map(AIRCRAFT_CATALOG.map((aircraft) => [aircraft.aircraftId, aircraft]));

export function aircraftById(aircraftId: string) {
  return AIRCRAFT_BY_ID.get(aircraftId) ?? null;
}

export function isAircraftId(value: unknown): value is string {
  return typeof value === "string" && AIRCRAFT_BY_ID.has(value);
}
