interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  return Response.json(body, {
    ...init,
    headers,
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        stage: "C0_FOUNDATION",
        service: "cas-flight-simulator",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
