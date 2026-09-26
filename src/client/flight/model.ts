import { THEATER } from "../../shared/config";

export type FlightInput = Readonly<{
  pitch: number;
  roll: number;
  throttle: number;
}>;

export type QuaternionState = Readonly<{
  w: number;
  x: number;
  y: number;
  z: number;
}>;

export type LocalBodyFrame = Readonly<{
  // ENU components: [east, north, up].
  forward: readonly [number, number, number];
  left: readonly [number, number, number];
  up: readonly [number, number, number];
}>;

export type FlightState = Readonly<{
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
  orientation: QuaternionState;
  pitchRateDegS: number;
  rollRateDegS: number;
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
const MIN_ALTITUDE_M = 0;
const MAX_ALTITUDE_M = 9_000;
const SPEED_RESPONSE_MPS2 = 42;
// An arcade speed offset from the vertical component of the flight direction.
// A level aircraft keeps the existing throttle-to-speed behavior exactly.
const VERTICAL_SPEED_OFFSET_MPS = 50;

// C1.5 control-response contract. Angle authority remains unlimited; only
// angular velocity is bounded so sustained input stays controllable.
const MAX_PITCH_RATE_DEG_S = 34;
const MAX_ROLL_RATE_DEG_S = 72;
const PITCH_ACCEL_DEG_S2 = 70;
const ROLL_ACCEL_DEG_S2 = 160;
const PITCH_RELEASE_DECEL_DEG_S2 = 180;
const ROLL_RELEASE_DECEL_DEG_S2 = 360;
const LEVEL_CAPTURE_DEG = 3;
const LEVEL_CAPTURE_RATE_DEG_S = 18;
const LEVEL_CAPTURE_RATE_THRESHOLD_DEG_S = 1.5;

// Release turn coupling. Bank produces a deliberately gentle, bounded heading
// change without exposing a direct yaw control. sin(bank) keeps the response
// smooth through continuous rolls and naturally returns turn authority to zero
// when the aircraft is wings-level or fully inverted. Near vertical flight,
// heading authority fades out because geographic heading is poorly defined.
const BANK_TURN_MAX_RATE_DEG_S = 3.5;

const THROTTLE_RATE_PER_S = 0.42;
const EPSILON = 1e-9;

type Vec3 = readonly [number, number, number];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const approach = (value: number, target: number, maximumStep: number) => {
  if (value < target) return Math.min(value + maximumStep, target);
  if (value > target) return Math.max(value - maximumStep, target);
  return value;
};

const wrapDegrees = (value: number) => ((value % 360) + 360) % 360;

const wrapSignedDegrees = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
};

const wrapLongitude = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radiansValue: number) => (radiansValue * 180) / Math.PI;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (value: Vec3) => Math.hypot(value[0], value[1], value[2]);
const normalizeVec = (value: Vec3): Vec3 => {
  const length = magnitude(value);
  if (length <= EPSILON) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
};

const normalizeQuaternion = (value: QuaternionState): QuaternionState => {
  const length = Math.hypot(value.w, value.x, value.y, value.z);
  if (length <= EPSILON || !Number.isFinite(length)) return { w: 1, x: 0, y: 0, z: 0 };
  return {
    w: value.w / length,
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
};

const multiplyQuaternion = (a: QuaternionState, b: QuaternionState): QuaternionState =>
  normalizeQuaternion({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });

const axisAngleQuaternion = (axis: Vec3, angleRad: number): QuaternionState => {
  const normalizedAxis = normalizeVec(axis);
  const half = angleRad * 0.5;
  const scale = Math.sin(half);
  return normalizeQuaternion({
    w: Math.cos(half),
    x: normalizedAxis[0] * scale,
    y: normalizedAxis[1] * scale,
    z: normalizedAxis[2] * scale,
  });
};

const rotateVector = (orientation: QuaternionState, value: Vec3): Vec3 => {
  const q = normalizeQuaternion(orientation);
  const u: Vec3 = [q.x, q.y, q.z];
  const uv = dot(u, value);
  const uu = dot(u, u);
  const uxv = cross(u, value);
  return [
    2 * uv * u[0] + (q.w * q.w - uu) * value[0] + 2 * q.w * uxv[0],
    2 * uv * u[1] + (q.w * q.w - uu) * value[1] + 2 * q.w * uxv[1],
    2 * uv * u[2] + (q.w * q.w - uu) * value[2] + 2 * q.w * uxv[2],
  ];
};

function orientationFromNavigationAttitude(
  headingDeg: number,
  pitchDeg: number,
  bankDeg: number,
): QuaternionState {
  // Identity body frame points east (+X), left/north (+Y), up (+Z).
  // Navigation heading 0° points north, hence the +90° - heading yaw.
  const yaw = axisAngleQuaternion([0, 0, 1], radians(90 - headingDeg));
  // Body +Y points left, so nose-up pitch is a negative rotation about +Y.
  const pitch = axisAngleQuaternion([0, 1, 0], radians(-pitchDeg));
  // Positive roll raises the left wing (right-wing-down), matching D input.
  const roll = axisAngleQuaternion([1, 0, 0], radians(bankDeg));
  return multiplyQuaternion(multiplyQuaternion(yaw, pitch), roll);
}

function bodyFrameFromOrientation(orientation: QuaternionState): LocalBodyFrame {
  return {
    forward: normalizeVec(rotateVector(orientation, [1, 0, 0])),
    left: normalizeVec(rotateVector(orientation, [0, 1, 0])),
    up: normalizeVec(rotateVector(orientation, [0, 0, 1])),
  };
}

export function getLocalBodyFrame(state: FlightState): LocalBodyFrame {
  return bodyFrameFromOrientation(state.orientation);
}

function attitudeFromOrientation(orientation: QuaternionState) {
  const frame = bodyFrameFromOrientation(orientation);
  const forward = frame.forward;
  const horizontalMagnitude = Math.hypot(forward[0], forward[1]);

  const headingDeg = horizontalMagnitude > EPSILON
    ? wrapDegrees(degrees(Math.atan2(forward[0], forward[1])))
    : 0;
  const pitchDeg = degrees(Math.asin(clamp(forward[2], -1, 1)));

  // Bank is the roll of the body-left axis around the forward vector relative
  // to a world-up-derived no-bank reference. It is display-only; orientation
  // itself has no bank limit and can roll continuously through 360°.
  let referenceLeft = normalizeVec(cross([0, 0, 1], forward));
  if (magnitude(referenceLeft) <= EPSILON) {
    referenceLeft = normalizeVec(cross([0, 1, 0], forward));
  }
  const referenceUp = normalizeVec(cross(forward, referenceLeft));
  const bankDeg = wrapSignedDegrees(
    degrees(Math.atan2(dot(frame.left, referenceUp), dot(frame.left, referenceLeft))),
  );

  return { headingDeg, pitchDeg, bankDeg };
}

function updateAngularRate(
  previousRateDegS: number,
  input: number,
  maxRateDegS: number,
  accelerationDegS2: number,
  releaseDecelerationDegS2: number,
  dt: number,
) {
  if (Math.abs(input) > 0.01) {
    return approach(previousRateDegS, input * maxRateDegS, accelerationDegS2 * dt);
  }
  return approach(previousRateDegS, 0, releaseDecelerationDegS2 * dt);
}

function correctionTowardZero(angleDeg: number, dt: number) {
  if (Math.abs(angleDeg) > LEVEL_CAPTURE_DEG) return 0;
  const step = Math.min(Math.abs(angleDeg), LEVEL_CAPTURE_RATE_DEG_S * dt);
  return -Math.sign(angleDeg) * step;
}

function bankDrivenHeadingRateDegS(bankDeg: number, pitchDeg: number) {
  const horizontalAuthority = Math.max(0, Math.cos(radians(pitchDeg)));
  return Math.sin(radians(bankDeg)) * BANK_TURN_MAX_RATE_DEG_S * horizontalAuthority;
}

export function createInitialFlightState(): FlightState {
  return {
    latitudeDeg: THEATER.centerLatitudeDeg,
    longitudeDeg: THEATER.centerLongitudeDeg,
    altitudeM: 5_400,
    orientation: orientationFromNavigationAttitude(35, 0, 0),
    pitchRateDegS: 0,
    rollRateDegS: 0,
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
  const throttleInput = clamp(input.throttle, -1, 1);

  const throttle = clamp(previous.throttle + throttleInput * THROTTLE_RATE_PER_S * dt, 0, 1);

  // Keyboard input now commands angular acceleration rather than instantaneous
  // angular velocity. Holding a key builds pitch/roll rate; releasing it applies
  // a stronger braking acceleration so the rate falls rapidly but continuously.
  const pitchRateDegS = updateAngularRate(
    previous.pitchRateDegS,
    pitchInput,
    MAX_PITCH_RATE_DEG_S,
    PITCH_ACCEL_DEG_S2,
    PITCH_RELEASE_DECEL_DEG_S2,
    dt,
  );
  const rollRateDegS = updateAngularRate(
    previous.rollRateDegS,
    rollInput,
    MAX_ROLL_RATE_DEG_S,
    ROLL_ACCEL_DEG_S2,
    ROLL_RELEASE_DECEL_DEG_S2,
    dt,
  );

  // Apply commanded rotations in body coordinates. Because orientation maps
  // body -> local ENU, post-multiplication keeps W/S on the aircraft lateral
  // axis and A/D on its forward axis at every bank attitude.
  const pitchDelta = axisAngleQuaternion(
    [0, 1, 0],
    radians(-pitchRateDegS * dt),
  );
  const rollDelta = axisAngleQuaternion(
    [1, 0, 0],
    radians(rollRateDegS * dt),
  );

  let orientation = multiplyQuaternion(
    multiplyQuaternion(previous.orientation, pitchDelta),
    rollDelta,
  );

  // Near level, and only after the commanded angular rate has essentially
  // stopped, capture small pitch/bank errors back to exactly 0°. Outside ±3°
  // there is no auto-level authority, preserving unrestricted attitude.
  let attitude = attitudeFromOrientation(orientation);
  if (
    Math.abs(pitchInput) <= 0.01
    && Math.abs(pitchRateDegS) <= LEVEL_CAPTURE_RATE_THRESHOLD_DEG_S
  ) {
    const pitchCorrectionDeg = correctionTowardZero(attitude.pitchDeg, dt);
    if (pitchCorrectionDeg !== 0) {
      orientation = multiplyQuaternion(
        orientation,
        axisAngleQuaternion([0, 1, 0], radians(-pitchCorrectionDeg)),
      );
    }
  }

  attitude = attitudeFromOrientation(orientation);
  if (
    Math.abs(rollInput) <= 0.01
    && Math.abs(rollRateDegS) <= LEVEL_CAPTURE_RATE_THRESHOLD_DEG_S
  ) {
    const bankCorrectionDeg = correctionTowardZero(attitude.bankDeg, dt);
    if (bankCorrectionDeg !== 0) {
      orientation = multiplyQuaternion(
        orientation,
        axisAngleQuaternion([1, 0, 0], radians(bankCorrectionDeg)),
      );
    }
  }

  // Release heading behavior is bank-mediated rather than directly commanded.
  // Pre-multiplication applies the bounded turn about local/world up, rotating
  // the complete aircraft attitude while preserving the current body attitude.
  attitude = attitudeFromOrientation(orientation);
  const headingTurnRateDegS = bankDrivenHeadingRateDegS(attitude.bankDeg, attitude.pitchDeg);
  if (Math.abs(headingTurnRateDegS) > EPSILON) {
    const headingTurnDelta = axisAngleQuaternion(
      [0, 0, 1],
      radians(-headingTurnRateDegS * dt),
    );
    orientation = multiplyQuaternion(headingTurnDelta, orientation);
  }

  const forward = rotateVector(orientation, [1, 0, 0]);
  const levelTargetSpeedMps = MIN_SPEED_MPS + (MAX_SPEED_MPS - MIN_SPEED_MPS) * throttle;
  const targetSpeedMps = clamp(
    levelTargetSpeedMps - forward[2] * VERTICAL_SPEED_OFFSET_MPS,
    MIN_SPEED_MPS,
    MAX_SPEED_MPS,
  );
  const speedMps = approach(previous.speedMps, targetSpeedMps, SPEED_RESPONSE_MPS2 * dt);
  const rawVerticalSpeedMps = speedMps * forward[2];
  const unclampedAltitudeM = previous.altitudeM + rawVerticalSpeedMps * dt;
  const altitudeM = clamp(unclampedAltitudeM, MIN_ALTITUDE_M, MAX_ALTITUDE_M);
  const verticalSpeedMps = dt > 0 ? (altitudeM - previous.altitudeM) / dt : 0;

  const distanceEastM = speedMps * forward[0] * dt;
  const distanceNorthM = speedMps * forward[1] * dt;
  const latitudeRad = radians(previous.latitudeDeg);
  const nextLatitudeRad = latitudeRad + distanceNorthM / EARTH_RADIUS_M;
  const safeCosLatitude = Math.max(0.05, Math.abs(Math.cos(latitudeRad)));
  const longitudeRad = radians(previous.longitudeDeg) + distanceEastM / (EARTH_RADIUS_M * safeCosLatitude);

  const next: FlightState = {
    latitudeDeg: clamp(degrees(nextLatitudeRad), -85, 85),
    longitudeDeg: wrapLongitude(degrees(longitudeRad)),
    altitudeM,
    orientation,
    pitchRateDegS,
    rollRateDegS,
    speedMps,
    throttle,
    verticalSpeedMps,
  };

  const finite = [
    next.latitudeDeg,
    next.longitudeDeg,
    next.altitudeM,
    next.orientation.w,
    next.orientation.x,
    next.orientation.y,
    next.orientation.z,
    next.pitchRateDegS,
    next.rollRateDegS,
    next.speedMps,
    next.throttle,
    next.verticalSpeedMps,
  ].every(Number.isFinite);

  return finite ? next : createInitialFlightState();
}

/** Preserve the accepted control response when a rendered frame takes over 50 ms. */
export function integrateFlightElapsed(
  previous: FlightState,
  input: FlightInput,
  elapsedSeconds: number,
): FlightState {
  // Bound catch-up after a suspended tab, but never discard ordinary slow frames.
  let remaining = clamp(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0, 0, 0.25);
  let state = previous;
  while (remaining > 1e-8) {
    const step = Math.min(remaining, 1 / 60);
    state = integrateFlightState(state, input, step);
    remaining -= step;
  }
  return state;
}

export function toFlightTelemetry(state: FlightState): FlightTelemetry {
  const attitude = attitudeFromOrientation(state.orientation);
  return {
    speedKph: state.speedMps * 3.6,
    altitudeM: state.altitudeM,
    throttlePct: state.throttle * 100,
    headingDeg: attitude.headingDeg,
    pitchDeg: attitude.pitchDeg,
    bankDeg: attitude.bankDeg,
    verticalSpeedMps: state.verticalSpeedMps,
  };
}

export const INITIAL_FLIGHT_TELEMETRY = toFlightTelemetry(createInitialFlightState());
