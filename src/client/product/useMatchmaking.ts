import { useCallback, useEffect, useRef, useState } from "react";
import {
  MATCHMAKING_PATH,
  parseServerMatchmakingMessage,
  type MatchFoundAssignment,
} from "../../shared/matchmaking";

export type MatchmakingStatus = "idle" | "connecting" | "queued" | "matched" | "error";

function matchmakingUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${MATCHMAKING_PATH}`;
}

export function useMatchmaking() {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<MatchmakingStatus>("idle");
  const [queuedAtMs, setQueuedAtMs] = useState<number | null>(null);
  const [assignment, setAssignment] = useState<MatchFoundAssignment | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const cancel = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
      } catch {
        // Socket may already be closing.
      }
      socket.close(1000, "queue cancel");
    }
    setStatus("idle");
    setQueuedAtMs(null);
    setAssignment(null);
    setErrorMessage("");
  }, []);

  const enqueue = useCallback((fixedAircraftId: string | null) => {
    cancel();
    setStatus("connecting");
    setErrorMessage("");

    let socket: WebSocket;
    try {
      socket = new WebSocket(matchmakingUrl());
    } catch {
      setStatus("error");
      setErrorMessage("MATCHMAKING ENDPOINT UNAVAILABLE");
      return;
    }

    socketRef.current = socket;
    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      socket.send(JSON.stringify({ type: "enqueue", fixedAircraftId }));
    });

    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket || typeof event.data !== "string") return;
      const message = parseServerMatchmakingMessage(event.data);
      if (!message) return;

      if (message.type === "queued") {
        setQueuedAtMs(message.queuedAtMs);
        setStatus("queued");
        return;
      }

      if (message.type === "match_found") {
        socketRef.current = null;
        setAssignment(message.assignment);
        setStatus("matched");
        socket.close(1000, "match found");
        return;
      }

      setErrorMessage(message.message);
      setStatus("error");
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket) return;
      setStatus("error");
      setErrorMessage("MATCHMAKING CONNECTION ERROR");
    });

    socket.addEventListener("close", (event) => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (event.code === 1000) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setErrorMessage(event.reason || "MATCHMAKING CONNECTION CLOSED");
    });
  }, [cancel]);

  useEffect(() => () => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "app unmount");
  }, []);

  return {
    status,
    queuedAtMs,
    assignment,
    errorMessage,
    enqueue,
    cancel,
  } as const;
}
