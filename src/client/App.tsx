import { useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";
import { FlightHud } from "./components/FlightHud";
import { INITIAL_FLIGHT_TELEMETRY } from "./flight/model";

export default function App() {
  const [telemetry, setTelemetry] = useState(INITIAL_FLIGHT_TELEMETRY);

  return (
    <main className="app-shell">
      <EarthScene onTelemetry={setTelemetry} />
      <FlightHud telemetry={telemetry} />
      <DiagnosticsPanel />
    </main>
  );
}
