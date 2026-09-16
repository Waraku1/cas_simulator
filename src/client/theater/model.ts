import { THEATER } from "../../shared/config";

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_KILOMETER = 1_000;

export type TheaterState = "inside" | "warning" | "outside";

export type TheaterStatus = Readonly<{
  state: TheaterState;
  eastOffsetKm: number;
  northOffsetKm: number;
  signedEdgeDistanceKm: number;
}>;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radiansValue: number) => (radiansValue * 180) / Math.PI;

const signedLongitudeDeltaDeg = (longitudeDeg: number, referenceDeg: number) =>
  ((longitudeDeg - referenceDeg + 540) % 360) - 180;

export function evaluateTheaterPosition(latitudeDeg: number, longitudeDeg: number): TheaterStatus {
  const northM = radians(latitudeDeg - THEATER.centerLatitudeDeg) * EARTH_RADIUS_M;
  const eastM =
    radians(signedLongitudeDeltaDeg(longitudeDeg, THEATER.centerLongitudeDeg))
    * EARTH_RADIUS_M
    * Math.cos(radians(THEATER.centerLatitudeDeg));

  const halfWidthM = (THEATER.widthKm * METERS_PER_KILOMETER) / 2;
  const halfHeightM = (THEATER.heightKm * METERS_PER_KILOMETER) / 2;
  const eastMarginM = halfWidthM - Math.abs(eastM);
  const northMarginM = halfHeightM - Math.abs(northM);
  const signedEdgeDistanceKm = Math.min(eastMarginM, northMarginM) / METERS_PER_KILOMETER;

  const state: TheaterState = signedEdgeDistanceKm < 0
    ? "outside"
    : signedEdgeDistanceKm <= THEATER.warningBandKm
      ? "warning"
      : "inside";

  return {
    state,
    eastOffsetKm: eastM / METERS_PER_KILOMETER,
    northOffsetKm: northM / METERS_PER_KILOMETER,
    signedEdgeDistanceKm,
  };
}

export function getTheaterBoundaryDegrees(): ReadonlyArray<readonly [number, number]> {
  const halfWidthM = (THEATER.widthKm * METERS_PER_KILOMETER) / 2;
  const halfHeightM = (THEATER.heightKm * METERS_PER_KILOMETER) / 2;
  const latitudeOffsetDeg = degrees(halfHeightM / EARTH_RADIUS_M);
  const longitudeOffsetDeg = degrees(
    halfWidthM / (EARTH_RADIUS_M * Math.cos(radians(THEATER.centerLatitudeDeg))),
  );

  const west = THEATER.centerLongitudeDeg - longitudeOffsetDeg;
  const east = THEATER.centerLongitudeDeg + longitudeOffsetDeg;
  const south = THEATER.centerLatitudeDeg - latitudeOffsetDeg;
  const north = THEATER.centerLatitudeDeg + latitudeOffsetDeg;

  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export const INITIAL_THEATER_STATUS = evaluateTheaterPosition(
  THEATER.centerLatitudeDeg,
  THEATER.centerLongitudeDeg,
);
