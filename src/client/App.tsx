import { APP_NAME, THEATER } from "../shared/config";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";

export default function App() {
  return (
    <main className="app-shell">
      <EarthScene />
      <header className="hud-header">
        <div>
          <strong>{APP_NAME}</strong>
          <span>C0 FOUNDATION</span>
        </div>
        <div className="hud-header__theater">
          THEATER {THEATER.widthKm} × {THEATER.heightKm} KM
        </div>
      </header>
      <DiagnosticsPanel />
      <footer className="hud-footer">
        <span>CESIUM EARTH</span>
        <span>FLIGHT / MULTIPLAYER MODULES: NOT YET ENABLED</span>
      </footer>
    </main>
  );
}
