import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  parseServerRoomMessage,
  type AircraftPose,
  type PoseSnapshot,
  SNAPSHOT_INTERVAL_MS,
} from "../../shared/multiplayer";

export type MultiplayerStatus =
  | "offline"
  | "connecting"
  | "waiting"
  | "connected"
  | "error";

export type RemotePoseBuffer = Readonly<{
  from: PoseSnapshot;
  to: PoseSnapshot;
  receivedAtMs: number;
}>;

export type MultiplayerController = Readonly<{
  status: MultiplayerStatus;
  roomCode: string;
  playerId: string | null;
  slot: 1 | 2 | null;
  peerConnected: boolean;
  remotePose: RemotePoseBuffer | null;
  errorMessage: string;
  createRoom: () => string;
  joinRoom: (roomCode: string) => boolean;
  disconnect: () => void;
  publishLocalPose: (pose: AircraftPose) => void;
}>;

function websocketUrl(roomCode: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/rooms/${roomCode}/ws`;
}

export function useMultiplayer(autoRoomCode: string | null = null): MultiplayerController {
  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(0);
  const latestPeerPoseRef = useRef<PoseSnapshot | null>(null);
  const [status, setStatus] = useState<MultiplayerStatus>("offline");
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [slot, setSlot] = useState<1 | 2 | null>(null);
  const [peerConnected, setPeerConnected] = useState(false);
  const [remotePose, setRemotePose] = useState<RemotePoseBuffer | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close(1000, "client disconnect");
    }
    sequenceRef.current = 0;
    latestPeerPoseRef.current = null;
    setRemotePose(null);
    setPeerConnected(false);
    setPlayerId(null);
    setSlot(null);
    setStatus("offline");
    setErrorMessage("");
  }, []);

  const connect = useCallback((requestedCode: string) => {
    const normalized = normalizeRoomCode(requestedCode);
    if (!isValidRoomCode(normalized)) {
      setErrorMessage("ROOM CODE MUST BE 6 CHARACTERS");
      setStatus("error");
      return false;
    }

    const previousSocket = socketRef.current;
    socketRef.current = null;
    if (previousSocket && previousSocket.readyState <= WebSocket.OPEN) {
      previousSocket.close(1000, "switch room");
    }

    setRoomCode(normalized);
    setPlayerId(null);
    setSlot(null);
    setPeerConnected(false);
    setRemotePose(null);
    latestPeerPoseRef.current = null;
    sequenceRef.current = 0;
    setErrorMessage("");
    setStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl(normalized));
    } catch {
      setErrorMessage("MULTIPLAYER ENDPOINT UNAVAILABLE");
      setStatus("error");
      return false;
    }

    socketRef.current = socket;

    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket || typeof event.data !== "string") return;
      const message = parseServerRoomMessage(event.data);
      if (!message) return;

      if (message.type === "welcome") {
        setPlayerId(message.playerId);
        setSlot(message.slot);
        setPeerConnected(message.peerConnected);
        setStatus(message.peerConnected ? "connected" : "waiting");
        return;
      }

      if (message.type === "presence") {
        setPeerConnected(message.peerConnected);
        setStatus(message.peerConnected ? "connected" : "waiting");
        if (!message.peerConnected) {
          latestPeerPoseRef.current = null;
          setRemotePose(null);
        }
        return;
      }

      if (message.type === "peer_pose") {
        const previous = latestPeerPoseRef.current ?? message.pose;
        latestPeerPoseRef.current = message.pose;
        setRemotePose({
          from: previous,
          to: message.pose,
          receivedAtMs: performance.now(),
        });
        return;
      }

      if (message.type === "error") {
        setErrorMessage(message.message);
        setStatus("error");
      }
      // C4C competition state/feedback is consumed by the ranked product client in
      // C4C-2. Manual C3 room clients intentionally ignore those message variants.
    });

    socket.addEventListener("close", (event) => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setPeerConnected(false);
      setPlayerId(null);
      setSlot(null);
      if (event.code === 1000) {
        setStatus("offline");
        setErrorMessage("");
      } else {
        setStatus("error");
        setErrorMessage(event.reason || "MULTIPLAYER CONNECTION CLOSED");
      }
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket) return;
      setStatus("error");
      setErrorMessage(
        window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
          ? "LOCAL MULTIPLAYER ENDPOINT UNAVAILABLE"
          : "MULTIPLAYER CONNECTION ERROR",
      );
    });

    return true;
  }, []);

  const createRoom = useCallback(() => {
    const generated = generateRoomCode();
    connect(generated);
    return generated;
  }, [connect]);

  const joinRoom = useCallback((requestedCode: string) => connect(requestedCode), [connect]);

  const publishLocalPose = useCallback((pose: AircraftPose) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const snapshot: PoseSnapshot = {
      ...pose,
      sequence: sequenceRef.current,
      clientTimeMs: performance.now(),
    };
    sequenceRef.current += 1;
    socket.send(JSON.stringify({ type: "pose", pose: snapshot }));
  }, []);

  useEffect(() => {
    if (!autoRoomCode) return;
    const normalized = normalizeRoomCode(autoRoomCode);
    if (!isValidRoomCode(normalized)) return;

    // React StrictMode runs effect setup -> cleanup -> setup in development.
    // Defer the actual socket creation until the next task so the probe setup's
    // timer is cancelled by cleanup before it can occupy a two-player room slot.
    const timer = window.setTimeout(() => {
      connect(normalized);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [autoRoomCode, connect]);

  useEffect(() => () => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close(1000, "app unmount");
    }
  }, []);

  return {
    status,
    roomCode,
    playerId,
    slot,
    peerConnected,
    remotePose,
    errorMessage,
    createRoom,
    joinRoom,
    disconnect,
    publishLocalPose,
  };
}

export const MULTIPLAYER_SNAPSHOT_INTERVAL_MS = SNAPSHOT_INTERVAL_MS;
