import { THEATER } from "../../shared/config";

export type FlightInput = Readonly<{
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
}>;

export type FlightState = Readonly<{
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
  headingDeg: number;
  pitchDeg: number;
  bankDeg: number;
  speedMps: number;
  throttle: number;
  verticalSpeedMps: number;
}>;

export type FlightTelemetry = Readonly<{
  speedKph: number;
  altitudeM: number;
  throttlePct: number;
  headingDeg: number;
  pitchDeg: number;
  bankDeg: number;
  verticalSpeedMps: number;
}>;

const EARTH_RADIUS_M = 6_371_000;
const MIN_SPEED_MPS = 90;
const MAX_SPEED_MPS = 230;
const MIN_ALTITUDE_M = 450;
const MAX_ALTITUDE_M = 9_000;
const MAX_PITCH_DEG = 35;
const MAX_BANK_DEG = 55;
const SPEED_RESPONSE_MPS2 = 42;
const PITCH_RATE_DEG_S = 28;
const BANK_RATE_DEG_S = 48;
const YAW_RATE_DEG_S = 12;
const BANK_TURN_RATE_DEG_S = 17;
const THROTTLE_RATE_PER_S = 0.42;
const PITCH_RECENTER_DEG_S = 7;
const BANK_RECENTER_DEG_S = 18;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const approach = (value: number, target: number, maximumStep: number) => {
  if (value < target) return Math.min(value + maximumStep, target);
  if (value > target) return Math.max(value - maximumStep, target);
  return value;
};

const wrapDegrees = (value: number) => ((value % 360) + 360) % 360;

const wrapLongitude = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
};

export function createInitialFlightState(): FlightState {
  return {
    latitudeDeg: THEATER.centerLatitudeDeg,
    longitudeDeg: THEATER.centerLongitudeDeg,
    altitudeM: 3_200,
    headingDeg: 35,
    pitchDeg: -1.5,
    bankDeg: 0,
    speedMps: 155,
    throttle: 0.56,
    verticalSpeedMps: 0,
  };
}

export function integrateFlightState(
  previous: FlightState,
  input: FlightInput,
  deltaSeconds: number,
): FlightState {
  const dt = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
  const pitchInput = clamp(input.pitch, -1, 1);
  const rollInput = clamp(input.roll, -1, 1);
  const yawInput = clamp(input.yaw, -1, 1);
  const throttleInput = clamp(input.throttle, -1, 1);

  const throttle = clamp(previous.throttle + throttleInput * THROTTLE_RATE_PER_S * dt, 0, 1);
  const targetSpeedMps = MIN_SPEED_MPS + (MAX_SPEED_MPS - MIN_SPEED_MPS) * throttle;
  const speedMps = approach(previous.speedMps, targetSpeedMps, SPEED_RESPONSE_MPS2 * dt);

  const pitchDeg = clamp(
    Math.abs(pitchInput) > 0.01
      ? previous.pitchDeg + pitchInput * PITCH_RATE_DEG_S * dt
      : approach(previous.pitchDeg, 0, PITCH_RECENTER_DEG_S * dt),
    -MAX_PITCH_DEG,
    MAX_PITCH_DEG,
  );

  const bankDeg = clamp(
    Math.abs(rollInput) > 0.01
      ? previous.bankDeg + rollInput * BANK_RATE_DEG_S * dt
      : approach(previous.bankDeg, 0, BANK_RECENTER_DEG_S * dt),
    -MAX_BANK_DEG,
    MAX_BANK_DEG,
  );

  const bankTurn = Math.sin((bankDeg * Math.PI) / 180) * BANK_TURN_RATE_DEG_S;
  const headingDeg = wrapDegrees(previous.headingDeg + (bankTurn + yawInput * YAW_RATE_DEG_S) * dt);

  const pitchRad = (pitchDeg * Math.PI) / 180;
  const headingRad = (headingDeg * Math.PI) / 180;
  const verticalSpeedMps = clamp(speedMps * Math.sin(pitchRad), -85, 85);
  const horizontalSpeedMps = speedMps * Math.cos(pitchRad);

  let altitudeM = clamp(previous.altitudeM + verticalSpeedMps * dt, MIN_ALTITUDE_M, MAX_ALTITUDE_M);
  let correctedPitchDeg = pitchDeg;
  if (altitudeM <= MIN_ALTITUDE_M && correctedPitchDeg < 0) correctedPitchDeg = 0;
  if (altitudeM >= MAX_ALTITUDE_M && correctedPitchDeg > 0) correctedPitchDeg = 0;

  const distanceNorthM = horizontalSpeedMps * Math.cos(headingRad) * dt;
  const distanceEastM = horizontalSpeedMps * Math.sin(headingRad) * dt;
  const latitudeRad = (previous.latitudeDeg * Math.PI) / 180;
  const nextLatitudeRad = latitudeRad + distanceNorthM / EARTH_RADIUS_M;
  const safeCosLatitude = Math.max(0.05, Math.abs(Math.cos(latitudeRad)));
  const longitudeRad = (previous.longitudeDeg * Math.PI) / 180 + distanceEastM / (EARTH_RADIUS_M * safeCosLatitude);

  const next: FlightState = {
    latitudeDeg: clamp((nextLatitudeRad * 180) / Math.PI, -85, 85),
    longitudeDeg: wrapLongitude((longitudeRad * 180) / Math.PI),
    altitudeM,
    headingDeg,
    pitchDeg: correctedPitchDeg,
    bankDeg,
    speedMps,
    throttle,
    verticalSpeedMps,
  };

  if (Object.values(next).every(Number.isFinite)) return next;
  return createInitialFlightState();
}

export function toFlightTelemetry(state: FlightState): FlightTelemetry {
  return {
    speedKph: state.speedMps * 3.6,
    altitudeM: state.altitudeM,
    throttlePct: state.throttle * 100,
    headingDeg: state.headingDeg,
    pitchDeg: state.pitchDeg,
    bankDeg: state.bankDeg,
    verticalSpeedMps: state.verticalSpeedMps,
  };
}

export const INITIAL_FLIGHT_TELEMETRY = toFlightTelemetry(createInitialFlightState());
