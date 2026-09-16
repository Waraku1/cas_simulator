import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  HeadingPitchRange,
  HeadingPitchRoll,
  Ion,
  Math as CesiumMath,
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
  type FlightTelemetry,
} from "../flight/model";

const CONTROLLED_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF"]);
const keyAxis = (keys: Set<string>, positive: string, negative: string) =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

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
      const initialOrientation = Transforms.headingPitchRollQuaternion(
        initialPosition,
        new HeadingPitchRoll(
          CesiumMath.toRadians(flightState.headingDeg),
          CesiumMath.toRadians(flightState.pitchDeg),
          CesiumMath.toRadians(flightState.bankDeg),
        ),
      );
      const positionProperty = new ConstantPositionProperty(initialPosition);
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

      const updateCamera = (position: Cartesian3) => {
        if (!viewer) return;
        viewer.camera.lookAt(
          position,
          new HeadingPitchRange(
            CesiumMath.toRadians(flightState.headingDeg + 180),
            CesiumMath.toRadians(-17 + flightState.pitchDeg * 0.08),
            520,
          ),
        );
      };

      const animate = (now: number) => {
        if (cancelled || !viewer) return;
        const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;

        const input: FlightInput = {
          pitch: keyAxis(pressedKeys, "KeyW", "KeyS"),
          roll: keyAxis(pressedKeys, "KeyD", "KeyA"),
          yaw: keyAxis(pressedKeys, "KeyE", "KeyQ"),
          throttle: keyAxis(pressedKeys, "KeyR", "KeyF"),
        };
        flightState = integrateFlightState(flightState, input, deltaSeconds);

        const position = Cartesian3.fromDegrees(
          flightState.longitudeDeg,
          flightState.latitudeDeg,
          flightState.altitudeM,
        );
        positionProperty.setValue(position);
        orientationProperty.setValue(
          Transforms.headingPitchRollQuaternion(
            position,
            new HeadingPitchRoll(
              CesiumMath.toRadians(flightState.headingDeg),
              CesiumMath.toRadians(flightState.pitchDeg),
              CesiumMath.toRadians(flightState.bankDeg),
            ),
          ),
        );
        updateCamera(position);

        if (now - lastTelemetryTime >= 90) {
          lastTelemetryTime = now;
          onTelemetry(toFlightTelemetry(flightState));
        }
        frameId = requestAnimationFrame(animate);
      };

      window.addEventListener("keydown", handleKeyDown, { passive: false });
      window.addEventListener("keyup", handleKeyUp, { passive: false });
      window.addEventListener("blur", handleBlur);
      updateCamera(initialPosition);
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
