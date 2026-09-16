import { useEffect, useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";
import { FlightHud } from "./components/FlightHud";
import { MultiplayerPanel } from "./components/MultiplayerPanel";
import { TheaterStatusPanel } from "./components/TheaterStatusPanel";
import { INITIAL_FLIGHT_TELEMETRY } from "./flight/model";
import { useMultiplayer, type MultiplayerStatus } from "./multiplayer/useMultiplayer";
import { INITIAL_THEATER_STATUS } from "./theater/model";

export type FlightRuntimeMultiplayerState = Readonly<{
  status: MultiplayerStatus;
  roomCode: string;
  peerConnected: boolean;
  errorMessage: string;
}>;

type FlightRuntimeProps = Readonly<{
  showDevelopmentPanels?: boolean;
  autoRoomCode?: string | null;
  onMultiplayerState?: (state: FlightRuntimeMultiplayerState) => void;
}>;

export function FlightRuntime({
  showDevelopmentPanels = true,
  autoRoomCode = null,
  onMultiplayerState,
}: FlightRuntimeProps) {
  const [telemetry, setTelemetry] = useState(INITIAL_FLIGHT_TELEMETRY);
  const [theaterStatus, setTheaterStatus] = useState(INITIAL_THEATER_STATUS);
  const multiplayer = useMultiplayer(autoRoomCode);

  useEffect(() => {
    onMultiplayerState?.({
      status: multiplayer.status,
      roomCode: multiplayer.roomCode,
      peerConnected: multiplayer.peerConnected,
      errorMessage: multiplayer.errorMessage,
    });
  }, [
    multiplayer.status,
    multiplayer.roomCode,
    multiplayer.peerConnected,
    multiplayer.errorMessage,
    onMultiplayerState,
  ]);

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
