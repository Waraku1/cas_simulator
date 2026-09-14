import {
  Cartesian3,
  Ion,
  Math as CesiumMath,
  Terrain,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useRef, useState } from "react";
import { THEATER } from "../../shared/config";

export function EarthScene() {
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
    let cancelled = false;

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

      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(
          THEATER.centerLongitudeDeg,
          THEATER.centerLatitudeDeg,
          THEATER.initialCameraHeightM,
        ),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-55),
          roll: 0,
        },
      });

      if (!cancelled) setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Unknown Cesium initialization error");
    }

    return () => {
      cancelled = true;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  return (
    <section className="earth-shell" aria-label="Cesium Earth viewport">
      <div className="earth-shell__viewport" ref={containerRef} />

      {status === "booting" && <div className="center-card">Initializing Cesium Earth…</div>}
      {status === "missing-token" && (
        <div className="center-card center-card--setup">
          <h1>Cesium token required</h1>
          <p>Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_CESIUM_ION_TOKEN</code>.</p>
        </div>
      )}
      {status === "error" && (
        <div className="center-card center-card--error">
          <h1>Earth initialization failed</h1>
          <p>{errorMessage}</p>
        </div>
      )}
    </section>
  );
}
