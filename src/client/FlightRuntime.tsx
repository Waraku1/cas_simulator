import { useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";
import { FlightHud } from "./components/FlightHud";
import { MultiplayerPanel } from "./components/MultiplayerPanel";
import { TheaterStatusPanel } from "./components/TheaterStatusPanel";
import { INITIAL_FLIGHT_TELEMETRY } from "./flight/model";
import { useMultiplayer } from "./multiplayer/useMultiplayer";
import { INITIAL_THEATER_STATUS } from "./theater/model";

type FlightRuntimeProps = Readonly<{
  showDevelopmentPanels?: boolean;
}>;

export function FlightRuntime({ showDevelopmentPanels = true }: FlightRuntimeProps) {
  const [telemetry, setTelemetry] = useState(INITIAL_FLIGHT_TELEMETRY);
  const [theaterStatus, setTheaterStatus] = useState(INITIAL_THEATER_STATUS);
  const multiplayer = useMultiplayer();

  return (
    <main className="app-shell">
      <EarthScene
        onLocalPose={multiplayer.publishLocalPose}
        onTelemetry={setTelemetry}
        onTheaterStatus={setTheaterStatus}
        remotePose={multiplayer.remotePose}
        localSlot={multiplayer.slot}
      />
      <FlightHud telemetry={telemetry} />
      <TheaterStatusPanel status={theaterStatus} />
      {showDevelopmentPanels && <MultiplayerPanel controller={multiplayer} />}
      {showDevelopmentPanels && <DiagnosticsPanel />}
    </main>
  );
}
