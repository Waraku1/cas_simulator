import { useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";
import { FlightHud } from "./components/FlightHud";
import { TheaterStatusPanel } from "./components/TheaterStatusPanel";
import { INITIAL_FLIGHT_TELEMETRY } from "./flight/model";
import { INITIAL_THEATER_STATUS } from "./theater/model";

export default function App() {
  const [telemetry, setTelemetry] = useState(INITIAL_FLIGHT_TELEMETRY);
  const [theaterStatus, setTheaterStatus] = useState(INITIAL_THEATER_STATUS);

  return (
    <main className="app-shell">
      <EarthScene onTelemetry={setTelemetry} onTheaterStatus={setTheaterStatus} />
      <FlightHud telemetry={telemetry} />
      <TheaterStatusPanel status={theaterStatus} />
      <DiagnosticsPanel />
    </main>
  );
}
