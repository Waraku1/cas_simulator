import { useCallback, useEffect, useState } from "react";
import {
  ACCOUNT_API,
  type AuthResponse,
  type LeaderboardProfile,
  type LeaderboardResponse,
  type PublicUserProfile,
} from "../../shared/auth";
import { deriveAuthCredential } from "../../shared/auth-credential";

export type AccountStatus = "loading" | "anonymous" | "authenticated" | "submitting" | "error";

async function authFetch(path: string, init?: RequestInit): Promise<AuthResponse> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  return response.json() as Promise<AuthResponse>;
}

export function useAccount() {
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [user, setUser] = useState<PublicUserProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const result = await authFetch(ACCOUNT_API.session);
      if (result.ok) {
        setUser(result.user);
        setStatus("authenticated");
        setErrorMessage("");
      } else {
        setUser(null);
        setStatus(result.code === "NOT_AUTHENTICATED" ? "anonymous" : "error");
        setErrorMessage(result.code === "NOT_AUTHENTICATED" ? "" : result.message);
      }
    } catch {
      setUser(null);
      setStatus("error");
      setErrorMessage("ACCOUNT SERVICE UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async (
    mode: "login" | "register",
    input: { loginId: string; displayName?: string; password: string },
  ) => {
    setStatus("submitting");
    setErrorMessage("");
    try {
      const credential = await deriveAuthCredential(input.loginId, input.password);
      const result = await authFetch(mode === "login" ? ACCOUNT_API.login : ACCOUNT_API.register, {
        method: "POST",
        body: JSON.stringify({
          loginId: input.loginId,
          ...(mode === "register" ? { displayName: input.displayName } : {}),
          credential,
        }),
      });
      if (!result.ok) {
        setUser(null);
        setStatus("anonymous");
        setErrorMessage(result.message);
        return false;
      }
      setUser(result.user);
      setStatus("authenticated");
      return true;
    } catch {
      setStatus("error");
      setErrorMessage("ACCOUNT SERVICE UNAVAILABLE");
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(ACCOUNT_API.logout, { method: "POST", credentials: "same-origin" });
    } finally {
      setUser(null);
      setStatus("anonymous");
      setErrorMessage("");
    }
  }, []);

  const setFixedAircraft = useCallback(async (aircraftId: string | null) => {
    setErrorMessage("");
    try {
      const result = await authFetch(ACCOUNT_API.fixedAircraft, {
        method: "PUT",
        body: JSON.stringify({ aircraftId }),
      });
      if (!result.ok) {
        setErrorMessage(result.message);
        return false;
      }
      setUser(result.user);
      return true;
    } catch {
      setErrorMessage("ACCOUNT SERVICE UNAVAILABLE");
      return false;
    }
  }, []);

  return {
    status,
    user,
    errorMessage,
    login: (loginId: string, password: string) => submit("login", { loginId, password }),
    register: (loginId: string, displayName: string, password: string) => submit("register", { loginId, displayName, password }),
    logout,
    refresh,
    setFixedAircraft,
  } as const;
}

export async function loadLeaderboard(): Promise<readonly LeaderboardProfile[]> {
  try {
    const response = await fetch(ACCOUNT_API.leaderboard, { credentials: "same-origin" });
    const result = await response.json() as LeaderboardResponse | { ok: false };
    return result.ok && "entries" in result ? result.entries : [];
  } catch {
    return [];
  }
}
