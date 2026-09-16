import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Ion,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Quaternion,
  Terrain,
  Transforms,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef, useState } from "react";
import {
  createInitialFlightState,
  integrateFlightState,
  toFlightTelemetry,
  type FlightInput,
  type FlightState,
  type FlightTelemetry,
} from "../flight/model";

const CONTROLLED_KEYS = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
]);
const keyAxis = (keys: Set<string>, positive: string, negative: string) =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

const CAMERA_BACK_M = 108;
const CAMERA_UP_M = 16;
const CAMERA_LOOK_AHEAD_M = 72;
const NOSE_OFFSET_M = 11;

type FlightFrame = Readonly<{
  forward: Cartesian3;
  left: Cartesian3;
  up: Cartesian3;
}>;

/**
 * Builds the aircraft body frame directly from the same navigation heading and
 * pitch conventions used by the flight integrator. This deliberately avoids
 * Cesium HPR heading conventions so visual forward and simulated motion cannot
 * diverge because of reference-frame sign/offset interpretation.
 *
 * Body axes are +X forward, +Y left, +Z up (right-handed).
 */
function computeFlightFrame(position: Cartesian3, state: FlightState): FlightFrame {
  const enu = Transforms.eastNorthUpToFixedFrame(position);
  const east = Matrix4.multiplyByPointAsVector(enu, Cartesian3.UNIT_X, new Cartesian3());
  const north = Matrix4.multiplyByPointAsVector(enu, Cartesian3.UNIT_Y, new Cartesian3());
  const localUp = Matrix4.multiplyByPointAsVector(enu, Cartesian3.UNIT_Z, new Cartesian3());
  Cartesian3.normalize(east, east);
  Cartesian3.normalize(north, north);
  Cartesian3.normalize(localUp, localUp);

  const heading = CesiumMath.toRadians(state.headingDeg);
  const pitch = CesiumMath.toRadians(state.pitchDeg);
  const bank = CesiumMath.toRadians(state.bankDeg);
  const sinHeading = Math.sin(heading);
  const cosHeading = Math.cos(heading);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const sinBank = Math.sin(bank);
  const cosBank = Math.cos(bank);

  // Same horizontal convention as integrateFlightState:
  // 0° = north, 90° = east.
  const horizontalForward = new Cartesian3(
    north.x * cosHeading + east.x * sinHeading,
    north.y * cosHeading + east.y * sinHeading,
    north.z * cosHeading + east.z * sinHeading,
  );
  const horizontalLeft = new Cartesian3(
    north.x * sinHeading - east.x * cosHeading,
    north.y * sinHeading - east.y * cosHeading,
    north.z * sinHeading - east.z * cosHeading,
  );

  const forward = new Cartesian3(
    horizontalForward.x * cosPitch + localUp.x * sinPitch,
    horizontalForward.y * cosPitch + localUp.y * sinPitch,
    horizontalForward.z * cosPitch + localUp.z * sinPitch,
  );
  const pitchedUp = new Cartesian3(
    localUp.x * cosPitch - horizontalForward.x * sinPitch,
    localUp.y * cosPitch - horizontalForward.y * sinPitch,
    localUp.z * cosPitch - horizontalForward.z * sinPitch,
  );

  // Positive bank is right-wing-down: left wing rises.
  const left = new Cartesian3(
    horizontalLeft.x * cosBank + pitchedUp.x * sinBank,
    horizontalLeft.y * cosBank + pitchedUp.y * sinBank,
    horizontalLeft.z * cosBank + pitchedUp.z * sinBank,
  );
  const up = new Cartesian3(
    pitchedUp.x * cosBank - horizontalLeft.x * sinBank,
    pitchedUp.y * cosBank - horizontalLeft.y * sinBank,
    pitchedUp.z * cosBank - horizontalLeft.z * sinBank,
  );

  Cartesian3.normalize(forward, forward);
  Cartesian3.normalize(left, left);
  Cartesian3.normalize(up, up);
  return { forward, left, up };
}

function orientationFromFrame(frame: FlightFrame) {
  const rotation = Matrix3.clone(Matrix3.IDENTITY, new Matrix3());
  Matrix3.setColumn(rotation, 0, frame.forward, rotation);
  Matrix3.setColumn(rotation, 1, frame.left, rotation);
  Matrix3.setColumn(rotation, 2, frame.up, rotation);
  return Quaternion.fromRotationMatrix(rotation);
}

function offsetFrom(position: Cartesian3, direction: Cartesian3, distanceM: number) {
  const offset = Cartesian3.multiplyByScalar(direction, distanceM, new Cartesian3());
  return Cartesian3.add(position, offset, offset);
}

export function EarthScene({ onTelemetry }: { onTelemetry: (telemetry: FlightTelemetry) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"booting" | "ready" | "missing-token" | "error">("booting");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
    if (!token) {
      setStatus("missing-token");
      return;
    }

    if (!containerRef.current) return;

    Ion.defaultAccessToken = token;
    let viewer: Viewer | undefined;
    let frameId = 0;
    let cancelled = false;
    let lastFrameTime = performance.now();
    let lastTelemetryTime = 0;
    let flightState = createInitialFlightState();
    const pressedKeys = new Set<string>();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!CONTROLLED_KEYS.has(event.code)) return;
      event.preventDefault();
      pressedKeys.add(event.code);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!CONTROLLED_KEYS.has(event.code)) return;
      event.preventDefault();
      pressedKeys.delete(event.code);
    };
    const handleBlur = () => pressedKeys.clear();

    try {
      viewer = new Viewer(containerRef.current, {
        terrain: Terrain.fromWorldTerrain(),
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
      });

      viewer.scene.globe.enableLighting = true;
      viewer.scene.fog.enabled = true;
      viewer.scene.requestRenderMode = false;
      viewer.scene.screenSpaceCameraController.enableInputs = false;

      const initialPosition = Cartesian3.fromDegrees(
        flightState.longitudeDeg,
        flightState.latitudeDeg,
        flightState.altitudeM,
      );
      const initialFrame = computeFlightFrame(initialPosition, flightState);
      const initialOrientation = orientationFromFrame(initialFrame);
      const positionProperty = new ConstantPositionProperty(initialPosition);
      const nosePositionProperty = new ConstantPositionProperty(
        offsetFrom(initialPosition, initialFrame.forward, NOSE_OFFSET_M),
      );
      const orientationProperty = new ConstantProperty(initialOrientation);
      const aircraftMaterial = Color.fromCssColorString("#d9fbff").withAlpha(0.92);
      const aircraftAccent = Color.fromCssColorString("#64e8ff").withAlpha(0.88);

      viewer.entities.add({
        position: positionProperty,
        orientation: orientationProperty,
        box: {
          dimensions: new Cartesian3(18, 3.2, 2.1),
          material: aircraftMaterial,
          outline: true,
          outlineColor: aircraftAccent,
        },
      });
      viewer.entities.add({
        position: positionProperty,
        orientation: orientationProperty,
        box: {
          dimensions: new Cartesian3(4.2, 22, 0.7),
          material: aircraftAccent.withAlpha(0.72),
        },
      });
      // Asymmetric nose marker makes the actual +X/forward end visually explicit.
      viewer.entities.add({
        position: nosePositionProperty,
        orientation: orientationProperty,
        box: {
          dimensions: new Cartesian3(5.2, 2.4, 1.4),
          material: aircraftAccent,
          outline: true,
          outlineColor: Color.WHITE.withAlpha(0.72),
        },
      });

      const updateCamera = (position: Cartesian3, frame: FlightFrame) => {
        if (!viewer) return;
        const cameraPosition = offsetFrom(position, frame.forward, -CAMERA_BACK_M);
        const cameraLift = Cartesian3.multiplyByScalar(frame.up, CAMERA_UP_M, new Cartesian3());
        Cartesian3.add(cameraPosition, cameraLift, cameraPosition);

        const lookTarget = offsetFrom(position, frame.forward, CAMERA_LOOK_AHEAD_M);
        const direction = Cartesian3.subtract(lookTarget, cameraPosition, new Cartesian3());
        Cartesian3.normalize(direction, direction);
        const right = Cartesian3.cross(direction, frame.up, new Cartesian3());
        Cartesian3.normalize(right, right);
        const cameraUp = Cartesian3.cross(right, direction, new Cartesian3());
        Cartesian3.normalize(cameraUp, cameraUp);

        viewer.camera.setView({
          destination: cameraPosition,
          orientation: { direction, up: cameraUp },
        });
      };

      const animate = (now: number) => {
        if (cancelled || !viewer) return;
        const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;

        const input: FlightInput = {
          pitch: keyAxis(pressedKeys, "KeyW", "KeyS"),
          roll: keyAxis(pressedKeys, "KeyD", "KeyA"),
          yaw: keyAxis(pressedKeys, "KeyE", "KeyQ"),
          throttle: keyAxis(pressedKeys, "ArrowUp", "ArrowDown"),
        };
        flightState = integrateFlightState(flightState, input, deltaSeconds);

        const position = Cartesian3.fromDegrees(
          flightState.longitudeDeg,
          flightState.latitudeDeg,
          flightState.altitudeM,
        );
        const flightFrame = computeFlightFrame(position, flightState);
        positionProperty.setValue(position);
        nosePositionProperty.setValue(offsetFrom(position, flightFrame.forward, NOSE_OFFSET_M));
        orientationProperty.setValue(orientationFromFrame(flightFrame));
        updateCamera(position, flightFrame);

        if (now - lastTelemetryTime >= 90) {
          lastTelemetryTime = now;
          onTelemetry(toFlightTelemetry(flightState));
        }
        frameId = requestAnimationFrame(animate);
      };

      window.addEventListener("keydown", handleKeyDown, { passive: false });
      window.addEventListener("keyup", handleKeyUp, { passive: false });
      window.addEventListener("blur", handleBlur);
      updateCamera(initialPosition, initialFrame);
      onTelemetry(toFlightTelemetry(flightState));
      frameId = requestAnimationFrame(animate);
      if (!cancelled) setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Unknown Cesium initialization error");
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [onTelemetry]);

  return (
    <section className="earth-shell" aria-label="Cesium Earth flight viewport">
      <div className="earth-shell__viewport" ref={containerRef} />

      {status === "booting" && <div className="center-card">Initializing flight environment…</div>}
      {status === "missing-token" && (
        <div className="center-card center-card--setup">
          <h1>Cesium token required</h1>
          <p>Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_CESIUM_ION_TOKEN</code>.</p>
        </div>
      )}
      {status === "error" && (
        <div className="center-card center-card--error">
          <h1>Flight environment failed</h1>
          <p>{errorMessage}</p>
        </div>
      )}
    </section>
  );
}
