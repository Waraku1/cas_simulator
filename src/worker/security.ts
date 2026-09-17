const RESPONSE_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-resource-policy": "same-origin",
});

export function isSameOriginBrowserRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function crossOriginRequestRejected() {
  return Response.json(
    {
      ok: false,
      code: "CROSS_ORIGIN_REQUEST_REJECTED",
      message: "This authenticated operation must originate from the CAS application origin.",
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

export function withSecurityHeaders(response: Response) {
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(RESPONSE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
