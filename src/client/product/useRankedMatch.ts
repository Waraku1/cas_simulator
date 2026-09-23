import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompetitionActionFeedbackCode,
  CompetitionStateSnapshot,
} from "../../shared/competition";
import type { MatchFoundAssignment } from "../../shared/matchmaking";
import {
  parseServerRoomMessage,
  type AircraftPose,
  type PoseSnapshot,
} from "../../shared/multiplayer";
import { MATCH_RULES, type WeaponId } from "../../shared/product";
import type {
  MultiplayerStatus,
  RemotePoseBuffer,
} from "../multiplayer/useMultiplayer";

const RECONNECT_DELAY_MS = 500;

export type RankedActionFeedback = Readonly<{
  accepted: boolean;
  code: CompetitionActionFeedbackCode;
  nextActionAtMs: number;
  weaponId: WeaponId | null;
  receivedAtMs: number;
}>;

export type RankedMatchController = Readonly<{
  status: MultiplayerStatus;
  roomCode: string;
  playerId: string | null;
  slot: 1 | 2 | null;
  peerConnected: boolean;
  remotePose: RemotePoseBuffer | null;
  errorMessage: string;
  matchState: CompetitionStateSnapshot | null;
  serverTimeOffsetMs: number;
  lastActionFeedback: RankedActionFeedback | null;
  publishLocalPose: (pose: AircraftPose) => void;
  fireWeapon: (weaponId: WeaponId) => boolean;
  leaveMatch: () => void;
}>;

function rankedMatchUrl(assignment: MatchFoundAssignment) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = encodeURIComponent(assignment.joinToken);
  return `${protocol}//${window.location.host}/api/matches/${assignment.matchId}/ws?token=${token}`;
}

export function useRankedMatch(assignment: MatchFoundAssignment): RankedMatchController {
  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(0);
  const latestPeerPoseRef = useRef<PoseSnapshot | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectStartedAtRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const matchStateRef = useRef<CompetitionStateSnapshot | null>(null);

  const [status, setStatus] = useState<MultiplayerStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [slot, setSlot] = useState<1 | 2 | null>(null);
  const [peerConnected, setPeerConnected] = useState(false);
  const [remotePose, setRemotePose] = useState<RemotePoseBuffer | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [matchState, setMatchState] = useState<CompetitionStateSnapshot | null>(null);
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [lastActionFeedback, setLastActionFeedback] = useState<RankedActionFeedback | null>(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    clearReconnectTimer();
    if (intentionalCloseRef.current || matchStateRef.current?.result) return;

    setStatus("connecting");
    setErrorMessage(reconnectStartedAtRef.current === null ? "" : "RECONNECTING TO MATCH");

    let socket: WebSocket;
    try {
      socket = new WebSocket(rankedMatchUrl(assignment));
    } catch {
      setStatus("error");
      setErrorMessage("RANKED MATCH ENDPOINT UNAVAILABLE");
      return;
    }

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      reconnectStartedAtRef.current = null;
      setErrorMessage("");
    });

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

      if (message.type === "match_state") {
        matchStateRef.current = message.state;
        setMatchState(message.state);
        setServerTimeOffsetMs(message.state.serverTimeMs - Date.now());
        return;
      }

      if (message.type === "action_feedback") {
        setLastActionFeedback({
          accepted: message.accepted,
          code: message.code,
          nextActionAtMs: message.nextActionAtMs,
          weaponId: message.weaponId ?? null,
          receivedAtMs: performance.now(),
        });
        return;
      }

      if (message.type === "error") {
        setStatus("error");
        setErrorMessage(message.message);
      }
    });

    socket.addEventListener("close", (event) => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setPeerConnected(false);
      setPlayerId(null);
      setSlot(null);

      if (intentionalCloseRef.current || matchStateRef.current?.result) {
        setStatus("offline");
        return;
      }

      const now = Date.now();
      const reconnectStartedAt = reconnectStartedAtRef.current ?? now;
      reconnectStartedAtRef.current = reconnectStartedAt;
      const elapsed = now - reconnectStartedAt;
      const graceMs = MATCH_RULES.disconnectGraceSeconds * 1_000;
      if (elapsed >= graceMs) {
        setStatus("error");
        setErrorMessage(event.reason || "RECONNECT WINDOW EXPIRED");
        return;
      }

      setStatus("connecting");
      setErrorMessage("RECONNECTING TO MATCH");
      reconnectTimerRef.current = window.setTimeout(() => connectRef.current(), RECONNECT_DELAY_MS);
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket || intentionalCloseRef.current) return;
      setErrorMessage("RANKED MATCH CONNECTION INTERRUPTED");
    });
  }, [assignment, clearReconnectTimer]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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

  const fireWeapon = useCallback((weaponId: WeaponId) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || matchStateRef.current?.result) return false;
    socket.send(JSON.stringify({
      type: "action",
      clientTimeMs: performance.now(),
      weaponId,
    }));
    return true;
  }, []);

  const leaveMatch = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "leave_match" }));
    } catch {
      // The server will resolve an already-lost connection through disconnect grace.
    }
  }, [clearReconnectTimer]);

  useEffect(() => {
    intentionalCloseRef.current = false;
    reconnectStartedAtRef.current = null;
    sequenceRef.current = 0;
    latestPeerPoseRef.current = null;
    matchStateRef.current = null;
    setStatus("connecting");
    setPlayerId(null);
    setSlot(null);
    setPeerConnected(false);
    setRemotePose(null);
    setErrorMessage("");
    setMatchState(null);
    setServerTimeOffsetMs(0);
    setLastActionFeedback(null);

    // StrictMode runs setup -> cleanup -> setup in development. Deferring socket
    // creation prevents the probe setup from consuming the participant slot.
    const startupTimer = window.setTimeout(() => connectRef.current(), 0);

    return () => {
      window.clearTimeout(startupTimer);
      clearReconnectTimer();
      intentionalCloseRef.current = true;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close(1000, "ranked view unmount");
      }
    };
  }, [assignment.matchId, assignment.joinToken, clearReconnectTimer]);

  return {
    status,
    roomCode: assignment.roomCode,
    playerId,
    slot,
    peerConnected,
    remotePose,
    errorMessage,
    matchState,
    serverTimeOffsetMs,
    lastActionFeedback,
    publishLocalPose,
    fireWeapon,
    leaveMatch,
  };
}
