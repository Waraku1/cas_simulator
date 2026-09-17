import { useEffect, useState } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { EarthScene } from "./components/EarthScene";
import { FlightHud } from "./components/FlightHud";
import { MultiplayerPanel } from "./components/MultiplayerPanel";
import { TheaterStatusPanel } from "./components/TheaterStatusPanel";
import { PerformanceEvidenceProbe } from "./diagnostics/PerformanceEvidenceProbe";
import { INITIAL_FLIGHT_TELEMETRY } from "./flight/model";
import {
  useMultiplayer,
  type MultiplayerController,
  type MultiplayerStatus,
} from "./multiplayer/useMultiplayer";
import { INITIAL_THEATER_STATUS } from "./theater/model";

export type FlightRuntimeMultiplayerState = Readonly<{
  status: MultiplayerStatus;
  roomCode: string;
  peerConnected: boolean;
  errorMessage: string;
}>;

export type FlightNetworkController = Pick<
  MultiplayerController,
  | "status"
  | "roomCode"
  | "playerId"
  | "slot"
  | "peerConnected"
  | "remotePose"
  | "errorMessage"
  | "publishLocalPose"
>;

type FlightRuntimeProps = Readonly<{
  showDevelopmentPanels?: boolean;
  autoRoomCode?: string | null;
  externalNetworkController?: FlightNetworkController | null;
  stagingSlot?: 1 | 2 | null;
  onMultiplayerState?: (state: FlightRuntimeMultiplayerState) => void;
}>;

function productLinkLabel(status: MultiplayerStatus, peerConnected: boolean) {
  if (status === "connected" && peerConnected) return "PEER LINKED";
  if (status === "waiting") return "WAITING FOR PEER";
  if (status === "connecting") return "CONNECTING";
  if (status === "error") return "LINK ERROR";
  return "OFFLINE";
}

export function FlightRuntime({
  showDevelopmentPanels = true,
  autoRoomCode = null,
  externalNetworkController = null,
  stagingSlot = null,
  onMultiplayerState,
}: FlightRuntimeProps) {
  const [telemetry, setTelemetry] = useState(INITIAL_FLIGHT_TELEMETRY);
  const [theaterStatus, setTheaterStatus] = useState(INITIAL_THEATER_STATUS);
  const manualMultiplayer = useMultiplayer(externalNetworkController ? null : autoRoomCode);
  const multiplayer = externalNetworkController ?? manualMultiplayer;

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

  const showProductLinkState = !showDevelopmentPanels
    && (Boolean(autoRoomCode) || externalNetworkController !== null);

  return (
    <main className="app-shell">
      <EarthScene
        onLocalPose={multiplayer.publishLocalPose}
        onTelemetry={setTelemetry}
        onTheaterStatus={setTheaterStatus}
        remotePose={multiplayer.remotePose}
        localSlot={stagingSlot ?? multiplayer.slot}
      />
      <FlightHud telemetry={telemetry} />
      <TheaterStatusPanel status={theaterStatus} />
      {showDevelopmentPanels && <MultiplayerPanel controller={manualMultiplayer} />}
      {showDevelopmentPanels && <DiagnosticsPanel />}
      {!showDevelopmentPanels && <PerformanceEvidenceProbe />}
      {showProductLinkState && (
        <div
          aria-live="polite"
          title={multiplayer.errorMessage || undefined}
          style={{
            position: "absolute",
            zIndex: 18,
            right: 22,
            bottom: 22,
            display: "grid",
            gap: 3,
            minWidth: 142,
            maxWidth: 260,
            padding: "8px 11px",
            border: "1px solid rgba(150, 228, 244, 0.22)",
            borderRadius: 8,
            background: "rgba(3, 14, 19, 0.72)",
            backdropFilter: "blur(10px)",
            pointerEvents: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            textShadow: "0 1px 10px rgba(0, 0, 0, 0.72)",
          }}
        >
          <span style={{ fontSize: 8, letterSpacing: "0.16em", color: "rgba(225, 248, 255, 0.55)" }}>
            ROOM {multiplayer.roomCode || autoRoomCode || "—"}
          </span>
          <strong style={{ fontSize: 10, letterSpacing: "0.12em", color: "#eaffff" }}>
            {productLinkLabel(multiplayer.status, multiplayer.peerConnected)}
          </strong>
          {multiplayer.status === "error" && multiplayer.errorMessage && (
            <small style={{ fontSize: 8, lineHeight: 1.35, color: "rgba(255, 196, 174, 0.82)" }}>
              {multiplayer.errorMessage}
            </small>
          )}
        </div>
      )}
    </main>
  );
}
