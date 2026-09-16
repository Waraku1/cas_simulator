import { useEffect, useState } from "react";
import { normalizeRoomCode } from "../../shared/multiplayer";
import type { MultiplayerController } from "../multiplayer/useMultiplayer";

type MultiplayerPanelProps = Readonly<{
  controller: MultiplayerController;
}>;

const statusCopy: Record<MultiplayerController["status"], string> = {
  offline: "OFFLINE",
  connecting: "CONNECTING",
  waiting: "WAITING FOR PEER",
  connected: "2 PLAYERS CONNECTED",
  error: "NETWORK UNAVAILABLE",
};

export function MultiplayerPanel({ controller }: MultiplayerPanelProps) {
  const [roomInput, setRoomInput] = useState(controller.roomCode);

  useEffect(() => {
    if (controller.roomCode) setRoomInput(controller.roomCode);
  }, [controller.roomCode]);

  const connected = controller.status === "waiting" || controller.status === "connected";
  const busy = controller.status === "connecting";

  return (
    <aside className={`multiplayer-panel multiplayer-panel--${controller.status}`} aria-label="C3 multiplayer room">
      <div className="multiplayer-panel__header">
        <span>MULTIPLAYER</span>
        <strong>{statusCopy[controller.status]}</strong>
      </div>

      <div className="multiplayer-panel__room">
        <input
          aria-label="Room code"
          autoComplete="off"
          disabled={busy || connected}
          inputMode="text"
          maxLength={6}
          onChange={(event) => setRoomInput(normalizeRoomCode(event.target.value))}
          placeholder="ROOM CODE"
          spellCheck={false}
          value={roomInput}
        />
        <button
          disabled={busy || connected || roomInput.length !== 6}
          onClick={() => controller.joinRoom(roomInput)}
          type="button"
        >
          JOIN
        </button>
      </div>

      <div className="multiplayer-panel__actions">
        {!connected && !busy ? (
          <button
            onClick={() => setRoomInput(controller.createRoom())}
            type="button"
          >
            CREATE ROOM
          </button>
        ) : (
          <button onClick={controller.disconnect} type="button">LEAVE ROOM</button>
        )}
      </div>

      {controller.roomCode && (
        <div className="multiplayer-panel__code">
          <span>ROOM</span>
          <strong>{controller.roomCode}</strong>
        </div>
      )}

      <div className="multiplayer-panel__meta">
        <span>{controller.peerConnected ? "PEER ONLINE" : "PEER —"}</span>
        <span>{controller.playerId ? `ID ${controller.playerId.slice(0, 6)}` : "ID —"}</span>
      </div>

      {controller.errorMessage && (
        <p className="multiplayer-panel__error">{controller.errorMessage}</p>
      )}
    </aside>
  );
}
