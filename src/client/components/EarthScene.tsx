import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
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
import { aircraftById } from "../../shared/aircraft";
import { aircraftVisualForSpec } from "../../shared/aircraft-visuals";
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
const CAMERA_UP_M = 12;
const CAMERA_LOOK_AHEAD_M = 72;
const CAMERA_ROLL_FOLLOW = 0.2;
const REMOTE_EXTRAPOLATION_LIMIT_MS = 180;
const REMOTE_SMOOTHING_TIME_CONSTANT_MS = 65;
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
  localAircraftId: string | null;
  peerAircraftId: string | null;
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

function bodyRotationFromFrame(frame: FlightFrame) {
  const rotation = Matrix3.clone(Matrix3.IDENTITY, new Matrix3());
  Matrix3.setColumn(rotation, 0, frame.forward, rotation);
  Matrix3.setColumn(rotation, 1, frame.left, rotation);
  Matrix3.setColumn(rotation, 2, frame.up, rotation);
  return rotation;
}

function orientationFromFrame(frame: FlightFrame) {
  return Quaternion.fromRotationMatrix(bodyRotationFromFrame(frame));
}

// glTF uses +Y up and -Z as the conventional forward direction. CAS uses a
// right-handed body frame of +X forward, +Y left, +Z up.
const GLTF_TO_CAS_BODY = new Matrix3(
  0, 0, -1,
  -1, 0, 0,
  0, 1, 0,
);

function modelOrientationFromFrame(frame: FlightFrame) {
  const modelToWorld = Matrix3.multiply(
    bodyRotationFromFrame(frame),
    GLTF_TO_CAS_BODY,
    new Matrix3(),
  );
  return Quaternion.fromRotationMatrix(modelToWorld);
}

function offsetFrom(position: Cartesian3, direction: Cartesian3, distanceM: number) {
  const offset = Cartesian3.multiplyByScalar(direction, distanceM, new Cartesian3());
  return Cartesian3.add(position, offset, offset);
}

function geodeticUpAt(position: Cartesian3) {
  const enu = Transforms.eastNorthUpToFixedFrame(position);
  const up = Matrix4.multiplyByPointAsVector(
    enu,
    new Cartesian3(0, 0, 1),
    new Cartesian3(),
  );
  return Cartesian3.normalize(up, up);
}

function stabilizedCameraUp(position: Cartesian3, frame: FlightFrame) {
  const worldUp = geodeticUpAt(position);
  const blended = Cartesian3.lerp(
    worldUp,
    frame.up,
    CAMERA_ROLL_FOLLOW,
    new Cartesian3(),
  );
  return Cartesian3.normalize(blended, blended);
}

function clampRemoteSegmentDuration(buffer: RemotePoseBuffer) {
  const duration = buffer.to.clientTimeMs - buffer.from.clientTimeMs;
  if (!Number.isFinite(duration) || duration <= 0) return SNAPSHOT_INTERVAL_MS;
  return Math.min(250, Math.max(50, duration));
}

function predictRemotePose(buffer: RemotePoseBuffer, now: number) {
  const segmentDurationMs = clampRemoteSegmentDuration(buffer);
  const extrapolationMs = Math.min(
    REMOTE_EXTRAPOLATION_LIMIT_MS,
    Math.max(0, now - buffer.receivedAtMs),
  );
  const factor = 1 + extrapolationMs / segmentDurationMs;
  const orientationFactor = Math.min(1.35, factor);

  return {
    latitudeDeg: buffer.from.latitudeDeg
      + (buffer.to.latitudeDeg - buffer.from.latitudeDeg) * factor,
    longitudeDeg: buffer.from.longitudeDeg
      + (buffer.to.longitudeDeg - buffer.from.longitudeDeg) * factor,
    altitudeM: buffer.from.altitudeM
      + (buffer.to.altitudeM - buffer.from.altitudeM) * factor,
    orientation: interpolateNetworkOrientation(
      buffer.from.orientation,
      buffer.to.orientation,
      orientationFactor,
    ),
  };
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
  localAircraftId,
  peerAircraftId,
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

    const localAircraft = localAircraftId ? aircraftById(localAircraftId) : null;
    const peerAircraft = peerAircraftId ? aircraftById(peerAircraftId) : null;
    const localVisual = aircraftVisualForSpec(localAircraft);
    const peerVisual = aircraftVisualForSpec(peerAircraft);

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
    let renderedRemotePose: AircraftPose | null = null;
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
      const initialOrientation = localVisual
        ? modelOrientationFromFrame(initialFrame)
        : orientationFromFrame(initialFrame);
      const positionProperty = new ConstantPositionProperty(initialPosition);
      const nosePositionProperty = new ConstantPositionProperty(
        offsetFrom(initialPosition, initialFrame.forward, NOSE_OFFSET_M),
      );
      const orientationProperty = new ConstantProperty(initialOrientation);
      const aircraftMaterial = Color.fromCssColorString("#d9fbff").withAlpha(0.92);
      const aircraftAccent = Color.fromCssColorString("#64e8ff").withAlpha(0.88);

      if (localVisual) {
        viewer.entities.add({
          name: `CAS local aircraft // ${localVisual.realAircraftName}`,
          position: positionProperty,
          orientation: orientationProperty,
          model: {
            uri: localVisual.modelUri,
            scale: localVisual.scale * (localAircraft?.visualScale ?? 1),
            minimumPixelSize: localVisual.minimumPixelSize,
            maximumScale: localVisual.maximumScale,
            silhouetteColor: aircraftAccent,
            silhouetteSize: 1.5,
          },
        });
      } else {
        viewer.entities.add({
          name: "CAS local aircraft fallback",
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
          name: "CAS local wings fallback",
          position: positionProperty,
          orientation: orientationProperty,
          box: {
            dimensions: new Cartesian3(4.2, 22, 0.7),
            material: aircraftAccent.withAlpha(0.72),
          },
        });
        viewer.entities.add({
          name: "CAS local nose fallback",
          position: nosePositionProperty,
          orientation: orientationProperty,
          box: {
            dimensions: new Cartesian3(5.2, 2.4, 1.4),
            material: aircraftAccent,
            outline: true,
            outlineColor: Color.WHITE.withAlpha(0.72),
          },
        });
      }

      const remotePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteNosePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteInitialOrientation = peerVisual
        ? modelOrientationFromFrame(initialFrame)
        : orientationFromFrame(initialFrame);
      const remoteOrientationProperty = new ConstantProperty(remoteInitialOrientation);
      const remoteMaterial = Color.fromCssColorString("#ffd48a").withAlpha(0.9);
      const remoteAccent = Color.fromCssColorString("#ff9f43").withAlpha(0.9);
      const remoteEntities: Entity[] = [];

      if (peerVisual) {
        remoteEntities.push(viewer.entities.add({
          name: `C3 peer aircraft // ${peerVisual.realAircraftName}`,
          show: false,
          position: remotePositionProperty,
          orientation: remoteOrientationProperty,
          model: {
            uri: peerVisual.modelUri,
            scale: peerVisual.scale * (peerAircraft?.visualScale ?? 1),
            minimumPixelSize: peerVisual.minimumPixelSize,
            maximumScale: peerVisual.maximumScale,
            silhouetteColor: remoteAccent,
            silhouetteSize: 2.5,
          },
        }));
      } else {
        remoteEntities.push(
          viewer.entities.add({
            name: "C3 peer aircraft fallback",
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
            name: "C3 peer wings fallback",
            show: false,
            position: remotePositionProperty,
            orientation: remoteOrientationProperty,
            box: {
              dimensions: new Cartesian3(4.2, 22, 0.7),
              material: remoteAccent.withAlpha(0.72),
            },
          }),
          viewer.entities.add({
            name: "C3 peer nose fallback",
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
        );
      }

      remoteEntities.push(viewer.entities.add({
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
      }));

      const updateCamera = (position: Cartesian3, frame: FlightFrame) => {
        if (!viewer) return;
        const cameraReferenceUp = stabilizedCameraUp(position, frame);
        const cameraPosition = offsetFrom(position, frame.forward, -CAMERA_BACK_M);
        const cameraLift = Cartesian3.multiplyByScalar(
          cameraReferenceUp,
          CAMERA_UP_M,
          new Cartesian3(),
        );
        Cartesian3.add(cameraPosition, cameraLift, cameraPosition);

        const lookTarget = offsetFrom(position, frame.forward, CAMERA_LOOK_AHEAD_M);
        const direction = Cartesian3.subtract(lookTarget, cameraPosition, new Cartesian3());
        Cartesian3.normalize(direction, direction);

        const right = Cartesian3.cross(direction, cameraReferenceUp, new Cartesian3());
        if (Cartesian3.magnitudeSquared(right) < 1e-8) {
          Cartesian3.clone(frame.left, right);
          Cartesian3.negate(right, right);
        } else {
          Cartesian3.normalize(right, right);
        }
        const cameraUp = Cartesian3.cross(right, direction, new Cartesian3());
        Cartesian3.normalize(cameraUp, cameraUp);

        viewer.camera.setView({
          destination: cameraPosition,
          orientation: { direction, up: cameraUp },
        });
      };

      const updateRemoteAircraft = (now: number, frameDeltaMs = SIMULATION_FRAME_INTERVAL_MS) => {
        const buffer = remotePoseRef.current;
        for (const entity of remoteEntities) entity.show = buffer !== null;
        if (!buffer) {
          renderedRemotePose = null;
          return;
        }

        const predicted = predictRemotePose(buffer, now);
        if (!renderedRemotePose) {
          renderedRemotePose = predicted;
        } else {
          const smoothingAmount = 1 - Math.exp(
            -Math.max(0, frameDeltaMs) / REMOTE_SMOOTHING_TIME_CONSTANT_MS,
          );
          renderedRemotePose = {
            latitudeDeg: renderedRemotePose.latitudeDeg
              + (predicted.latitudeDeg - renderedRemotePose.latitudeDeg) * smoothingAmount,
            longitudeDeg: renderedRemotePose.longitudeDeg
              + (predicted.longitudeDeg - renderedRemotePose.longitudeDeg) * smoothingAmount,
            altitudeM: renderedRemotePose.altitudeM
              + (predicted.altitudeM - renderedRemotePose.altitudeM) * smoothingAmount,
            orientation: interpolateNetworkOrientation(
              renderedRemotePose.orientation,
              predicted.orientation,
              smoothingAmount,
            ),
          };
        }

        const position = Cartesian3.fromDegrees(
          renderedRemotePose.longitudeDeg,
          renderedRemotePose.latitudeDeg,
          renderedRemotePose.altitudeM,
        );
        const frame = computeNetworkFlightFrame(position, renderedRemotePose.orientation);
        remotePositionProperty.setValue(position);
        remoteNosePositionProperty.setValue(offsetFrom(position, frame.forward, NOSE_OFFSET_M));
        remoteOrientationProperty.setValue(
          peerVisual ? modelOrientationFromFrame(frame) : orientationFromFrame(frame),
        );
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
        orientationProperty.setValue(
          localVisual ? modelOrientationFromFrame(flightFrame) : orientationFromFrame(flightFrame),
        );
        updateCamera(position, flightFrame);
        updateRemoteAircraft(now, elapsedMs);

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
  }, [localAircraftId, peerAircraftId, onLocalPose, onTelemetry, onTheaterStatus]);

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