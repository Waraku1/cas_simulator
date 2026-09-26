import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  Ion,
  Matrix3,
  Matrix4,
  Model,
  Quaternion,
  Terrain,
  Transforms,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef, useState } from "react";
import { aircraftById } from "../../shared/aircraft";
import { aircraftVisualForSpec } from "../../shared/aircraft-visuals";
import { GAME_GROUND_CLEARANCE_M, gameGroundContact } from "../../shared/game-ground.mjs";
import { ARCADE_LOCK, ARCADE_PROJECTILES } from "../../shared/arcade-projectiles.mjs";
import type { CompetitionProjectileSnapshot } from "../../shared/competition";
import { C2_RESOURCE_BUDGET } from "../../shared/config";
import {
  SNAPSHOT_INTERVAL_MS,
  type AircraftPose,
  type GameView,
  type NetworkQuaternion,
} from "../../shared/multiplayer";
import type { WeaponId } from "../../shared/product";
import { recordRenderedFrame } from "../diagnostics/useRuntimeDiagnostics";
import {
  createInitialFlightState,
  getLocalBodyFrame,
  integrateFlightElapsed,
  toFlightTelemetry,
  type FlightInput,
  type FlightState,
  type FlightTelemetry,
} from "../flight/model";
import { returningLook } from "../flight/look-return.mjs";
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

const CAMERA_BACK_M = ARCADE_LOCK.cameraBackM;
const CAMERA_UP_M = ARCADE_LOCK.cameraUpM;
const CAMERA_LOOK_AHEAD_M = ARCADE_LOCK.cameraLookAheadM;
const PROJECTILE_VISUAL_LEAD_MS = 120;
const PROJECTILE_VISUAL_CORRECTION_S = 0.04;
const REMOTE_EXTRAPOLATION_LIMIT_MS = 180;
const REMOTE_SMOOTHING_TIME_CONSTANT_MS = 65;
const NOSE_OFFSET_M = 11;
const REMOTE_MARKER_LIFT_M = 19;
const MULTIPLAYER_STAGING_LONGITUDE_OFFSET_DEG = 0.00055;
const SIMULATION_FRAME_INTERVAL_MS = 1_000 / C2_RESOURCE_BUDGET.runtimeFrameCapFps;
const MODEL_HEADING_CORRECTION = Matrix3.fromRotationZ(Math.PI, new Matrix3());
const MODEL_HEADING_QUATERNION = Quaternion.fromRotationMatrix(MODEL_HEADING_CORRECTION);

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
  onLocalPose: (pose: AircraftPose & { view?: GameView }) => void;
  remotePose: RemotePoseBuffer | null;
  localSlot: 1 | 2 | null;
  localAircraftId: string | null;
  peerAircraftId: string | null;
  competitiveModels?: boolean;
  selectedWeaponId?: WeaponId | null;
  peerLocked?: boolean;
  projectiles?: readonly CompetitionProjectileSnapshot[];
  projectileServerTimeMs?: number;
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

function modelOrientationFromFrame(frame: FlightFrame) {
  return Quaternion.multiply(orientationFromFrame(frame), MODEL_HEADING_QUATERNION, new Quaternion());
}

function modelMatrixFromFrame(position: Cartesian3, frame: FlightFrame,
  proportions: readonly [number, number, number] = [1, 1, 1]) {
  const rotation = Matrix3.multiply(bodyRotationFromFrame(frame), MODEL_HEADING_CORRECTION, new Matrix3());
  const matrix = Matrix4.fromRotationTranslation(rotation, position, new Matrix4());
  return Matrix4.multiplyByScale(matrix, new Cartesian3(...proportions), matrix);
}

function offsetFrom(position: Cartesian3, direction: Cartesian3, distanceM: number) {
  const offset = Cartesian3.multiplyByScalar(direction, distanceM, new Cartesian3());
  return Cartesian3.add(position, offset, offset);
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
    || target instanceof HTMLSelectElement
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
  competitiveModels = false,
  selectedWeaponId = null,
  peerLocked = false,
  projectiles,
  projectileServerTimeMs,
}: EarthSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const peerMarkerRef = useRef<Entity | null>(null);
  const projectileEntitiesRef = useRef(new Map<number, {
    entity: Entity;
    position: ConstantPositionProperty;
    trail?: Entity;
    trailPositions?: ConstantProperty;
    displayed: Cartesian3;
    anchor: Cartesian3;
    velocity: Cartesian3;
    receivedAtMs: number;
    serverTimeMs: number;
    weaponId: WeaponId;
  }>());
  const remotePoseRef = useRef(remotePose);
  const localSlotRef = useRef(localSlot);
  const weaponRef = useRef(selectedWeaponId);
  const [status, setStatus] = useState<"booting" | "ready" | "missing-token" | "error">("booting");
  const [errorMessage, setErrorMessage] = useState("");
  const [modelIssue, setModelIssue] = useState("");

  useEffect(() => {
    remotePoseRef.current = remotePose;
  }, [remotePose]);

  useEffect(() => {
    localSlotRef.current = localSlot;
  }, [localSlot]);

  useEffect(() => {
    weaponRef.current = selectedWeaponId;
  }, [selectedWeaponId]);

  useEffect(() => {
    const marker = peerMarkerRef.current;
    if (!marker) return;
    if (marker.label) {
      marker.label.text = new ConstantProperty(peerLocked ? "LOCKED" : "PEER");
      marker.label.fillColor = new ConstantProperty(peerLocked ? Color.fromCssColorString("#ffe4a8") : Color.WHITE);
    }
    if (marker.point) {
      marker.point.pixelSize = new ConstantProperty(peerLocked ? 18 : 13);
      marker.point.color = new ConstantProperty(peerLocked ? Color.fromCssColorString("#ff654e") : Color.fromCssColorString("#ff9f43"));
    }
  }, [peerLocked]);

  useEffect(() => {
    setModelIssue("");
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
    if (!token) {
      setStatus("missing-token");
      return;
    }

    if (!containerRef.current) return;
    const viewport = containerRef.current;

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
    let cameraOrientation = flightState.orientation;
    let renderedRemotePose: AircraftPose | null = null;
    let localModel: Model | undefined;
    let remoteModel: Model | undefined;
    let localModelFailed = false;
    let remoteModelFailed = false;
    let removeViewListeners = () => {};
    let viewYawRad = 0;
    let viewPitchRad = 0;
    let lookReturn: { startedAtMs: number; yawRad: number; pitchRad: number } | null = null;
    let localGroundHeightM = 0;
    let groundContactSent = false;
    let activePointerId: number | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let lastLookSnapshotTime = 0;
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
    const handleVisibilityChange = () => {
      if (document.hidden) pressedKeys.clear();
      lastFrameTime = performance.now();
    };

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
      viewerRef.current = viewer;

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
      // The Bell X-1 asset points opposite the game's forward axis. Correct
      // its horizontal heading only; the flight frame and camera stay intact.
      const initialOrientation = orientationFromFrame(initialFrame);
      const positionProperty = new ConstantPositionProperty(initialPosition);
      const nosePositionProperty = new ConstantPositionProperty(
        offsetFrom(initialPosition, initialFrame.forward, NOSE_OFFSET_M),
      );
      const orientationProperty = new ConstantProperty(initialOrientation);
      const modelOrientationProperty = new ConstantProperty(modelOrientationFromFrame(initialFrame));
      const aircraftMaterial = Color.fromCssColorString("#d9fbff").withAlpha(0.92);
      const aircraftAccent = Color.fromCssColorString("#64e8ff").withAlpha(0.88);
      const localFallback: Entity[] = [];
      let latestLocalModelMatrix = modelMatrixFromFrame(initialPosition, initialFrame, localVisual.proportions);

      if (localVisual && !competitiveModels) {
        viewer.entities.add({
          name: `CAS local aircraft // ${localVisual.realAircraftName}`,
          position: positionProperty,
          orientation: modelOrientationProperty,
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
        localFallback.push(viewer.entities.add({
          name: "CAS local aircraft fallback",
          position: positionProperty,
          orientation: orientationProperty,
          box: {
            dimensions: new Cartesian3(18 * localVisual.proportions[0] * (localAircraft?.visualScale ?? 1),
              3.2 * localVisual.proportions[1], 2.1 * localVisual.proportions[2]),
            material: aircraftMaterial,
            outline: true,
            outlineColor: aircraftAccent,
          },
        }));
        localFallback.push(viewer.entities.add({
          name: "CAS local wings fallback",
          position: positionProperty,
          orientation: orientationProperty,
          box: {
            dimensions: new Cartesian3(4.2 * localVisual.proportions[0],
              22 * localVisual.proportions[1] * (localAircraft?.visualScale ?? 1), 0.7),
            material: aircraftAccent.withAlpha(0.72),
          },
        }));
        localFallback.push(viewer.entities.add({
          name: "CAS local nose fallback",
          position: nosePositionProperty,
          orientation: orientationProperty,
          box: {
            dimensions: new Cartesian3(5.2, 2.4, 1.4),
            material: aircraftAccent,
            outline: true,
            outlineColor: Color.WHITE.withAlpha(0.72),
          },
        }));
      }

      const remotePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteNosePositionProperty = new ConstantPositionProperty(initialPosition);
      const remoteMarkerPositionProperty = new ConstantPositionProperty(
        offsetFrom(initialPosition, initialFrame.up, REMOTE_MARKER_LIFT_M),
      );
      const remoteInitialOrientation = orientationFromFrame(initialFrame);
      const remoteOrientationProperty = new ConstantProperty(remoteInitialOrientation);
      const remoteModelOrientationProperty = new ConstantProperty(modelOrientationFromFrame(initialFrame));
      const remoteMaterial = Color.fromCssColorString("#ffd48a").withAlpha(0.9);
      const remoteAccent = Color.fromCssColorString("#ff9f43").withAlpha(0.9);
      const remoteEntities: Entity[] = [];
      const remoteFallback: Entity[] = [];
      let latestRemoteModelMatrix = modelMatrixFromFrame(initialPosition, initialFrame, peerVisual.proportions);

      if (peerVisual && !competitiveModels) {
        remoteEntities.push(viewer.entities.add({
          name: `C3 peer aircraft // ${peerVisual.realAircraftName}`,
          show: false,
          position: remotePositionProperty,
          orientation: remoteModelOrientationProperty,
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
        remoteFallback.push(
          viewer.entities.add({
            name: "C3 peer aircraft fallback",
            show: false,
            position: remotePositionProperty,
            orientation: remoteOrientationProperty,
            box: {
              dimensions: new Cartesian3(18 * peerVisual.proportions[0] * (peerAircraft?.visualScale ?? 1),
                3.2 * peerVisual.proportions[1], 2.1 * peerVisual.proportions[2]),
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
              dimensions: new Cartesian3(4.2 * peerVisual.proportions[0],
                22 * peerVisual.proportions[1] * (peerAircraft?.visualScale ?? 1), 0.7),
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
        remoteEntities.push(...remoteFallback);
      }

      // In a ranked flight, manage the GLB explicitly. Entity ModelGraphics
      // reports asynchronous model failures only in the console; a primitive
      // lets the match retain a visible fallback until the model is ready.
      const loadCompetitiveModel = async (local: boolean) => {
        const visual = local ? localVisual : peerVisual;
        if (!visual || !viewer) return;
        try {
          const model = await Model.fromGltfAsync({
            url: visual.modelUri,
            scene: viewer.scene,
            modelMatrix: local ? latestLocalModelMatrix : latestRemoteModelMatrix,
            scale: visual.scale * ((local ? localAircraft : peerAircraft)?.visualScale ?? 1),
            minimumPixelSize: visual.minimumPixelSize,
            maximumScale: visual.maximumScale,
            silhouetteColor: local ? aircraftAccent : remoteAccent,
            silhouetteSize: local ? 1.5 : 2.5,
          });
          if (cancelled || viewer.isDestroyed()) {
            model.destroy();
            return;
          }
          model.errorEvent.addEventListener((error: Error) => {
            if (error.name === "TextureError" || cancelled) return;
            model.show = false;
            if (local) {
              localModelFailed = true;
              for (const entity of localFallback) entity.show = true;
            } else {
              remoteModelFailed = true;
              for (const entity of remoteFallback) entity.show = remotePoseRef.current !== null;
            }
            setModelIssue(`${visual.realAircraftName} 3D model could not be displayed; showing the backup shape.`);
          });
          model.modelMatrix = local ? latestLocalModelMatrix : latestRemoteModelMatrix;
          model.show = local || remotePoseRef.current !== null;
          viewer.scene.primitives.add(model);
          if (local) localModel = model;
          else remoteModel = model;
        } catch {
          if (!cancelled) {
            setModelIssue(`${visual.realAircraftName} 3D model could not be loaded; showing the backup shape.`);
          }
        }
      };
      if (competitiveModels) {
        void loadCompetitiveModel(true);
        void loadCompetitiveModel(false);
      }

      const peerMarker = viewer.entities.add({
        name: "C3 peer marker",
        show: false,
        position: remoteMarkerPositionProperty,
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
      });
      remoteEntities.push(peerMarker);
      peerMarkerRef.current = peerMarker;

      const updateCamera = (position: Cartesian3, frame: FlightFrame) => {
        if (!viewer) return;
        const orbit = Math.cos(viewPitchRad);
        const cameraPosition = offsetFrom(position, frame.forward,
          -CAMERA_BACK_M * Math.cos(viewYawRad) * orbit);
        Cartesian3.add(cameraPosition,
          Cartesian3.multiplyByScalar(frame.left, CAMERA_BACK_M * Math.sin(viewYawRad) * orbit, new Cartesian3()),
          cameraPosition);
        const cameraLift = Cartesian3.multiplyByScalar(
          frame.up,
          CAMERA_UP_M + CAMERA_BACK_M * Math.sin(viewPitchRad),
          new Cartesian3(),
        );
        Cartesian3.add(cameraPosition, cameraLift, cameraPosition);

        const lookTarget = offsetFrom(position, frame.forward,
          CAMERA_LOOK_AHEAD_M * Math.max(0, Math.cos(viewYawRad) * orbit));
        const direction = Cartesian3.subtract(lookTarget, cameraPosition, new Cartesian3());
        Cartesian3.normalize(direction, direction);

        const right = Cartesian3.cross(direction, frame.up, new Cartesian3());
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
        for (const entity of remoteFallback) {
          entity.show = buffer !== null && (!remoteModel?.ready || remoteModelFailed);
        }
        if (remoteModel) remoteModel.show = buffer !== null && !remoteModelFailed;
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
        if (competitiveModels) {
          latestRemoteModelMatrix = modelMatrixFromFrame(position, frame, peerVisual.proportions);
          if (remoteModel && !remoteModelFailed) remoteModel.modelMatrix = latestRemoteModelMatrix;
        }
        remotePositionProperty.setValue(position);
        remoteNosePositionProperty.setValue(offsetFrom(position, frame.forward, NOSE_OFFSET_M));
        remoteMarkerPositionProperty.setValue(offsetFrom(position, frame.up, REMOTE_MARKER_LIFT_M));
        remoteOrientationProperty.setValue(
          orientationFromFrame(frame),
        );
        remoteModelOrientationProperty.setValue(modelOrientationFromFrame(frame));
      };

      const updateProjectileVisuals = (now: number, deltaSeconds: number) => {
        for (const rendered of projectileEntitiesRef.current.values()) {
          const leadSeconds = Math.min(PROJECTILE_VISUAL_LEAD_MS, Math.max(0, now - rendered.receivedAtMs)) / 1_000;
          const estimate = Cartesian3.add(rendered.anchor,
            Cartesian3.multiplyByScalar(rendered.velocity, leadSeconds, new Cartesian3()), new Cartesian3());
          const blend = Cartesian3.distance(rendered.displayed, estimate) > 100
            ? 1
            : 1 - Math.exp(-Math.max(0, deltaSeconds) / PROJECTILE_VISUAL_CORRECTION_S);
          Cartesian3.lerp(rendered.displayed, estimate, blend, rendered.displayed);
          rendered.position.setValue(rendered.displayed);
          if (rendered.trailPositions) {
            const speed = Cartesian3.magnitude(rendered.velocity);
            const trailLength = rendered.weaponId === "gun" ? 32 : 38;
            const start = speed > 0.01
              ? Cartesian3.subtract(rendered.displayed,
                Cartesian3.multiplyByScalar(rendered.velocity, trailLength / speed, new Cartesian3()), new Cartesian3())
              : rendered.displayed;
            rendered.trailPositions.setValue([start, rendered.displayed]);
          }
        }
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
          groundHeightM: localGroundHeightM,
          orientation: {
            w: flightState.orientation.w,
            x: flightState.orientation.x,
            y: flightState.orientation.y,
            z: flightState.orientation.z,
          },
          ...(competitiveModels && weaponRef.current ? {
            view: { yawRad: viewYawRad, pitchRad: viewPitchRad,
              weaponId: weaponRef.current, looking: activePointerId !== null || lookReturn !== null },
          } : {}),
        });
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (!competitiveModels || activePointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
        lookReturn = null;
        activePointerId = event.pointerId;
        pointerX = event.clientX;
        pointerY = event.clientY;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("is-looking");
        publishNetworkPose();
        event.preventDefault();
      };
      const handlePointerMove = (event: PointerEvent) => {
        if (activePointerId !== event.pointerId) return;
        const dx = event.clientX - pointerX;
        const dy = event.clientY - pointerY;
        pointerX = event.clientX;
        pointerY = event.clientY;
        viewYawRad = ((viewYawRad + dx * 0.004 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        viewPitchRad = Math.max(-1.1, Math.min(1.1, viewPitchRad + dy * 0.004));
        const snapshotNow = performance.now();
        if (snapshotNow - lastLookSnapshotTime >= 40) {
          lastLookSnapshotTime = snapshotNow;
          publishNetworkPose();
        }
        event.preventDefault();
      };
      const handlePointerUp = (event: PointerEvent) => {
        if (activePointerId !== event.pointerId) return;
        activePointerId = null;
        viewport.classList.remove("is-looking");
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        lookReturn = viewYawRad !== 0 || viewPitchRad !== 0
          ? { startedAtMs: performance.now(), yawRad: viewYawRad, pitchRad: viewPitchRad }
          : null;
        publishNetworkPose();
      };
      const handleViewReset = (event: MouseEvent) => {
        if (!competitiveModels) return;
        lookReturn = null;
        viewYawRad = 0;
        viewPitchRad = 0;
        publishNetworkPose();
        event.preventDefault();
      };

      const applyMultiplayerStagingIfNeeded = () => {
        const slot = localSlotRef.current;
        if (slot === null) {
          appliedMultiplayerSlot = null;
          return;
        }
        if (appliedMultiplayerSlot === slot) return;

        flightState = stagedFlightState(slot);
        cameraOrientation = flightState.orientation;
        groundContactSent = false;
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

        const deltaSeconds = elapsedMs / 1_000;
        lastFrameTime = now;
        applyMultiplayerStagingIfNeeded();
        let finishedLookReturn = false;
        if (lookReturn) {
          const returned = returningLook(
            lookReturn.yawRad, lookReturn.pitchRad, now - lookReturn.startedAtMs,
          );
          viewYawRad = returned.yawRad;
          viewPitchRad = returned.pitchRad;
          if (returned.completed) {
            lookReturn = null;
            finishedLookReturn = true;
          }
        }

        const input: FlightInput = {
          pitch: keyAxis(pressedKeys, "KeyW", "KeyS"),
          roll: keyAxis(pressedKeys, "KeyD", "KeyA"),
          throttle: keyAxis(pressedKeys, "ArrowUp", "ArrowDown"),
        };
        flightState = integrateFlightElapsed(flightState, input, deltaSeconds, localAircraft);
        const sampledGround = viewer.scene.globe.getHeight(
          Cartographic.fromDegrees(flightState.longitudeDeg, flightState.latitudeDeg),
        );
        localGroundHeightM = Number.isFinite(sampledGround)
          ? Math.max(-500, Math.min(9_000, sampledGround!)) : 0;
        const touchedGround = gameGroundContact(flightState.altitudeM, localGroundHeightM);
        if (touchedGround) {
          flightState = {
            ...flightState,
            altitudeM: Math.max(0, localGroundHeightM) + GAME_GROUND_CLEARANCE_M,
            verticalSpeedMps: 0,
          };
        }

        const position = Cartesian3.fromDegrees(
          flightState.longitudeDeg,
          flightState.latitudeDeg,
          flightState.altitudeM,
        );
        const flightFrame = computeFlightFrame(position, flightState);
        const cameraBlend = 1 - Math.exp(-Math.max(0, elapsedMs) / 85);
        cameraOrientation = interpolateNetworkOrientation(cameraOrientation, flightState.orientation, cameraBlend);
        const cameraFrame = computeNetworkFlightFrame(position, cameraOrientation);
        if (competitiveModels) {
          latestLocalModelMatrix = modelMatrixFromFrame(position, flightFrame, localVisual.proportions);
          if (localModel && !localModelFailed) {
            localModel.modelMatrix = latestLocalModelMatrix;
            for (const entity of localFallback) entity.show = !localModel.ready;
          }
        }
        positionProperty.setValue(position);
        nosePositionProperty.setValue(offsetFrom(position, flightFrame.forward, NOSE_OFFSET_M));
        orientationProperty.setValue(orientationFromFrame(flightFrame));
        modelOrientationProperty.setValue(modelOrientationFromFrame(flightFrame));
        updateCamera(position, cameraFrame);
        updateRemoteAircraft(now, elapsedMs);
        updateProjectileVisuals(now, deltaSeconds);

        if (finishedLookReturn) {
          lastNetworkSnapshotTime = now;
          publishNetworkPose();
        }

        if (competitiveModels && touchedGround && !groundContactSent) {
          groundContactSent = true;
          lastNetworkSnapshotTime = now;
          publishNetworkPose();
        }
        if (!touchedGround) groundContactSent = false;

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
      document.addEventListener("visibilitychange", handleVisibilityChange);
      if (competitiveModels) {
        viewport.addEventListener("pointerdown", handlePointerDown);
        viewport.addEventListener("pointermove", handlePointerMove);
        viewport.addEventListener("pointerup", handlePointerUp);
        viewport.addEventListener("pointercancel", handlePointerUp);
        viewport.addEventListener("dblclick", handleViewReset);
        removeViewListeners = () => {
          viewport.removeEventListener("pointerdown", handlePointerDown);
          viewport.removeEventListener("pointermove", handlePointerMove);
          viewport.removeEventListener("pointerup", handlePointerUp);
          viewport.removeEventListener("pointercancel", handlePointerUp);
          viewport.removeEventListener("dblclick", handleViewReset);
          viewport.classList.remove("is-looking");
        };
      }
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
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      removeViewListeners();
      viewerRef.current = null;
      peerMarkerRef.current = null;
      projectileEntitiesRef.current.clear();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [competitiveModels, localAircraftId, peerAircraftId, onLocalPose, onTelemetry, onTheaterStatus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const active = new Set<number>();
    const receivedAtMs = performance.now();
    const serverTimeMs = projectileServerTimeMs ?? Date.now();
    for (const projectile of projectiles ?? []) {
      active.add(projectile.id);
      const position = Cartesian3.fromDegrees(
        projectile.longitudeDeg, projectile.latitudeDeg, projectile.altitudeM,
      );
      const existing = projectileEntitiesRef.current.get(projectile.id);
      if (existing) {
        const elapsedMs = serverTimeMs - existing.serverTimeMs;
        if (elapsedMs > 0) {
          const distance = Cartesian3.distance(position, existing.anchor);
          const maximumSpeed = ARCADE_PROJECTILES[projectile.weaponId].speed * 1.2;
          const speed = Math.min(maximumSpeed, distance * 1_000 / elapsedMs);
          const movement = Cartesian3.subtract(position, existing.anchor, new Cartesian3());
          existing.velocity = distance > 0
            ? Cartesian3.multiplyByScalar(movement, speed / distance, movement)
            : new Cartesian3();
        }
        existing.anchor = position;
        existing.receivedAtMs = receivedAtMs;
        existing.serverTimeMs = serverTimeMs;
      } else {
        const property = new ConstantPositionProperty(position);
        const gun = projectile.weaponId === "gun";
        const color = Color.fromCssColorString(gun ? "#ffe18a" : "#7ef5ff");
        const entity = viewer.entities.add({
          name: `Game projectile ${projectile.id}`,
          position: property,
          point: {
            pixelSize: gun ? 12 : 14,
            color,
            outlineColor: Color.WHITE,
            outlineWidth: gun ? 2 : 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        const trailPositions = new ConstantProperty([position, position]);
        const trail = viewer.entities.add({
          name: `Game projectile trail ${projectile.id}`,
          polyline: {
            positions: trailPositions,
            width: 3,
            material: color.withAlpha(0.88),
          },
        });
        projectileEntitiesRef.current.set(projectile.id, {
          entity,
          position: property,
          trail,
          trailPositions,
          displayed: Cartesian3.clone(position),
          anchor: Cartesian3.clone(position),
          velocity: new Cartesian3(),
          receivedAtMs,
          serverTimeMs,
          weaponId: projectile.weaponId,
        });
      }
    }
    for (const [id, rendered] of projectileEntitiesRef.current) {
      if (active.has(id)) continue;
      viewer.entities.remove(rendered.entity);
      if (rendered.trail) viewer.entities.remove(rendered.trail);
      projectileEntitiesRef.current.delete(id);
    }
  }, [projectiles, projectileServerTimeMs]);

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
      {status === "ready" && modelIssue && <div className="earth-shell__model-issue" role="status">{modelIssue}</div>}
    </section>
  );
}
