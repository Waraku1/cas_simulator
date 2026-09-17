import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Ion,
  Matrix3,
  Matrix4,
  Quaternion,
  Terrain,
  Transforms,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef, useState } from "react";
import { C2_RESOURCE_BUDGET } from "../../shared/config";
import {
  SNAPSHOT_INTERVAL_MS,
  type AircraftPose,
  type NetworkQuaternion,
} from "../../shared/multiplayer";
import { recordRenderedFrame } from "../diagnostics/useRuntimeDiagnostics";
import {
  createInitialFlightState,
  getLocalBodyFrame,
  integrateFlightState,
  toFlightTelemetry,
  type FlightInput,
  type FlightState,
  type FlightTelemetry,
} from "../flight/model";
import type { RemotePoseBuffer } from "../multiplayer/useMultiplayer";
import {
  evaluateTheaterPosition,
  getTheaterBoundaryDegrees,
  type TheaterStatus,
} from "../theater/model";

const CONTROLLED_KEYS = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
]);
const keyAxis = (keys: Set<string>, positive: string, negative: string) =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

const CAMERA_BACK_M = 108;
const CAMERA_UP_M = 16;
const CAMERA_LOOK_AHEAD_M = 72;
const NOSE_OFFSET_M = 11;
const MULTIPLAYER_STAGING_LONGITUDE_OFFSET_DEG = 0.00055;
const SIMULATION_FRAME_INTERVAL_MS = 1_000 / C2_RESOURCE_BUDGET.runtimeFrameCapFps;

type LocalAxes = Readonly<{
  forward: readonly [number, number, number];
  left: readonly [number, number, number];
  up: readonly [number, number, number];
}>;

type FlightFrame = Readonly<{
  forward: Cartesian3;
  left: Cartesian3;
  up: Cartesian3;
}>;

type EarthSceneProps = Readonly<{
  onTelemetry: (telemetry: FlightTelemetry) => void;
  onTheaterStatus: (status: TheaterStatus) => void;
  onLocalPose: (pose: AircraftPose) => void;
  remotePose: RemotePoseBuffer | null;
  localSlot: 1 | 2 | null;
}>;

function computeFixedFrame(position: Cartesian3, localFrame: LocalAxes): FlightFrame {
  const enu = Transforms.eastNorthUpToFixedFrame(position);
  const toFixed = (value: readonly [number, number, number]) => {
    const fixed = Matrix4.multiplyByPointAsVector(
      enu,
      new Cartesian3(value[0], value[1], value[2]),
      new Cartesian3(),
    );
    return Cartesian3.normalize(fixed, fixed);
  };

  return {
    forward: toFixed(localFrame.forward),
    left: toFixed(localFrame.left),
    up: toFixed(localFrame.up),
  };
}

function computeFlightFrame(position: Cartesian3, state: FlightState): FlightFrame {
  return computeFixedFrame(position, getLocalBodyFrame(state));
}

function rotateNetworkVector(
  orientation: NetworkQuaternion,
  value: readonly [number, number, number],
): readonly [number, number, number] {
  const length = Math.hypot(
    orientation.w,
    orientation.x,
    orientation.y,
    orientation.z,
  ) || 1;
  const w = orientation.w / length;
  const x = orientation.x / length;
  const y = orientation.y / length;
  const z = orientation.z / length;
  const [vx, vy, vz] = value;
  const dot = x * vx + y * vy + z * vz;
  const uu = x * x + y * y + z * z;
  const cx = y * vz - z * vy;
  const cy = z * vx - x * vz;
  const cz = x * vy - y * vx;
  return [
    2 * dot * x + (w * w - uu) * vx + 2 * w * cx,
    2 * dot * y + (w * w - uu) * vy + 2 * w * cy,
    2 * dot * z + (w * w - uu) * vz + 2 * w * cz,
  ];
}

function computeNetworkFlightFrame(
  position: Cartesian3,
  orientation: NetworkQuaternion,
): FlightFrame {
  return computeFixedFrame(position, {
    forward: rotateNetworkVector(orientation, [1, 0, 0]),
    left: rotateNetworkVector(orientation, [0, 1, 0]),
    up: rotateNetworkVector(orientation, [0, 0, 1]),
  });
}

function interpolateNetworkOrientation(
  from: NetworkQuaternion,
  to: NetworkQuaternion,
  amount: number,
): NetworkQuaternion {
  const start = new Quaternion(from.x, from.y, from.z, from.w);
  const end = new Quaternion(to.x, to.y, to.z, to.w);
  const result = Quaternion.slerp(start, end, amount, new Quaternion());
  return { w: result.w, x: result.x, y: result.y, z: result.z };
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

function stagedFlightState(slot: 1 | 2): FlightState {
  const initial = createInitialFlightState();
  return {
    ...initial,
    longitudeDeg: initial.longitudeDeg
      + (slot === 1 ? -MULTIPLAYER_STAGING_LONGITUDE_OFFSET_DEG : MULTIPLAYER_STAGING_LONGITUDE_OFFSET_DEG),
  };
}

function isFormTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLButtonElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

export function EarthScene({
  onTelemetry,
  onTheaterStatus,
  onLocalPose,
  remotePose,
  localSlot,
}: EarthSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const remotePoseRef = useRef(remotePose);
  const localSlotRef = useRef(localSlot);
  const [status, setStatus] = useState<"booting" | "ready" | "missing-token" | "error">("booting");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    remotePoseRef.current = remotePose;
  }, [remotePose]);

  useEffect(() => {
    localSlotRef.current = localSlot;
  }, [localSlot]);

  useEffect(() => {
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
    if (!token) {
      setStatus("missing-token");
      return;
    }

    if (!containerRef.current) return;

    Ion.defaultAccessToken = token;
    let viewer: Viewer | undefined;
    let removePostRenderListener: (() => void) | undefined;
    let frameId = 0;
    let cancelled = false;
    let lastFrameTime = performance.now();
    let lastTelemetryTime = 0;
    let lastNetworkSnapshotTime = 0;
    let appliedMultiplayerSlot: 1 | 2 | null = null;
    let flightState = createInitialFlightState();
    const pressedKeys = new Set<string>();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!CONTROLLED_KEYS.has(event.code) || isFormTarget(event.target)) return;
      event.preventDefault();
      pressedKeys.add(event.code);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!CONTROLLED_KEYS.has(event.code)) return;
      pressedKeys.delete(event.code);
      if (isFormTarget(event.target)) return;
      event.preventDefault();
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
        targetFrameRate: C2_RESOURCE_BUDGET.runtimeFrameCapFps,
        timeline: false,
      });

      viewer.scene.globe.enableLighting = true;
      viewer.scene.fog.enabled = true;
      viewer.scene.requestRenderMode = false;
      viewer.scene.screenSpaceCameraController.enableInputs = false;
      removePostRenderListener = viewer.scene.postRender.addEventListener(recordRenderedFrame);

      const boundaryPositions = getTheaterBoundaryDegrees().map(([longitudeDeg, latitudeDeg]) =>
        Cartesian3.fromDegrees(longitudeDeg, latitudeDeg),
      );
      viewer.entities.add({
        name: "C2 theater boundary",
        polyline: {
          positions: boundaryPositions,
          clampToGround: true,
          width: 2.5,
          material: Color.fromCssColorString("#76eaff").withAlpha(0.66),
        },
      });

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

      const remotePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteNosePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteOrientationProperty = new ConstantProperty(initialOrientation);
      const remoteMaterial = Color.fromCssColorString("#ffd48a").withAlpha(0.9);
      const remoteAccent = Color.fromCssColorString("#ff9f43").withAlpha(0.9);
      const remoteEntities = [
        viewer.entities.add({
          name: "C3 peer aircraft",
          show: false,
          position: remotePositionProperty,
          orientation: remoteOrientationProperty,
          box: {
            dimensions: new Cartesian3(18, 3.2, 2.1),
            material: remoteMaterial,
            outline: true,
            outlineColor: remoteAccent,
          },
        }),
        viewer.entities.add({
          name: "C3 peer wings",
          show: false,
          position: remotePositionProperty,
          orientation: remoteOrientationProperty,
          box: {
            dimensions: new Cartesian3(4.2, 22, 0.7),
            material: remoteAccent.withAlpha(0.72),
          },
        }),
        viewer.entities.add({
          name: "C3 peer nose",
          show: false,
          position: remoteNosePositionProperty,
          orientation: remoteOrientationProperty,
          box: {
            dimensions: new Cartesian3(5.2, 2.4, 1.4),
            material: remoteAccent,
            outline: true,
            outlineColor: Color.WHITE.withAlpha(0.68),
          },
        }),
        viewer.entities.add({
          name: "C3 peer marker",
          show: false,
          position: remotePositionProperty,
          point: {
            pixelSize: 13,
            color: remoteAccent,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: "PEER",
            font: "600 14px monospace",
            fillColor: Color.WHITE,
            showBackground: true,
            backgroundColor: Color.BLACK.withAlpha(0.62),
            pixelOffset: new Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      ];

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

      const updateRemoteAircraft = (now: number) => {
        const buffer = remotePoseRef.current;
        for (const entity of remoteEntities) entity.show = buffer !== null;
        if (!buffer) return;

        const alpha = Math.min(1, Math.max(0, (now - buffer.receivedAtMs) / SNAPSHOT_INTERVAL_MS));
        const latitudeDeg = buffer.from.latitudeDeg
          + (buffer.to.latitudeDeg - buffer.from.latitudeDeg) * alpha;
        const longitudeDeg = buffer.from.longitudeDeg
          + (buffer.to.longitudeDeg - buffer.from.longitudeDeg) * alpha;
        const altitudeM = buffer.from.altitudeM
          + (buffer.to.altitudeM - buffer.from.altitudeM) * alpha;
        const orientation = interpolateNetworkOrientation(
          buffer.from.orientation,
          buffer.to.orientation,
          alpha,
        );
        const position = Cartesian3.fromDegrees(longitudeDeg, latitudeDeg, altitudeM);
        const frame = computeNetworkFlightFrame(position, orientation);
        remotePositionProperty.setValue(position);
        remoteNosePositionProperty.setValue(offsetFrom(position, frame.forward, NOSE_OFFSET_M));
        remoteOrientationProperty.setValue(orientationFromFrame(frame));
      };

      const publishFlightState = () => {
        onTelemetry(toFlightTelemetry(flightState));
        onTheaterStatus(evaluateTheaterPosition(flightState.latitudeDeg, flightState.longitudeDeg));
      };

      const publishNetworkPose = () => {
        onLocalPose({
          latitudeDeg: flightState.latitudeDeg,
          longitudeDeg: flightState.longitudeDeg,
          altitudeM: flightState.altitudeM,
          orientation: {
            w: flightState.orientation.w,
            x: flightState.orientation.x,
            y: flightState.orientation.y,
            z: flightState.orientation.z,
          },
        });
      };

      const applyMultiplayerStagingIfNeeded = () => {
        const slot = localSlotRef.current;
        if (slot === null) {
          appliedMultiplayerSlot = null;
          return;
        }
        if (appliedMultiplayerSlot === slot) return;

        flightState = stagedFlightState(slot);
        appliedMultiplayerSlot = slot;
        lastNetworkSnapshotTime = 0;
      };

      const animate = (now: number) => {
        if (cancelled || !viewer) return;
        const elapsedMs = now - lastFrameTime;
        if (elapsedMs < SIMULATION_FRAME_INTERVAL_MS) {
          frameId = requestAnimationFrame(animate);
          return;
        }

        const deltaSeconds = Math.min(elapsedMs / 1_000, 0.05);
        lastFrameTime = now;
        applyMultiplayerStagingIfNeeded();

        const input: FlightInput = {
          pitch: keyAxis(pressedKeys, "KeyW", "KeyS"),
          roll: keyAxis(pressedKeys, "KeyD", "KeyA"),
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
        updateRemoteAircraft(now);

        if (now - lastTelemetryTime >= 90) {
          lastTelemetryTime = now;
          publishFlightState();
        }
        if (now - lastNetworkSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
          lastNetworkSnapshotTime = now;
          publishNetworkPose();
        }
        frameId = requestAnimationFrame(animate);
      };

      window.addEventListener("keydown", handleKeyDown, { passive: false });
      window.addEventListener("keyup", handleKeyUp, { passive: false });
      window.addEventListener("blur", handleBlur);
      updateCamera(initialPosition, initialFrame);
      publishFlightState();
      updateRemoteAircraft(performance.now());
      frameId = requestAnimationFrame(animate);
      if (!cancelled) setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Unknown Cesium initialization error");
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      removePostRenderListener?.();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [onLocalPose, onTelemetry, onTheaterStatus]);

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