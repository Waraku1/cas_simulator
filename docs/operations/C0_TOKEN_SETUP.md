# C0 — Cesium ion Token Setup

## Objective

Configure the minimum-permission browser token required for the C0 Cesium Earth runtime without committing credentials to Git.

## Security model

`VITE_CESIUM_ION_TOKEN` is a browser credential. It is kept out of Git history, but it is not a server-side secret because Vite embeds `VITE_*` values into the browser bundle.

Security therefore relies on least privilege plus Cesium ion restrictions:

- use a dedicated token for this application;
- enable only the public `assets:read` scope;
- do not enable `geocode` because the app disables the geocoder;
- do not enable any private scopes;
- restrict the token to the assets actually used by C0;
- restrict allowed URLs where practical.

## C0 assets

Current C0 code uses:

- Cesium World Terrain — asset ID `1`;
- the default Cesium global imagery used by the Viewer — asset ID `2`.

Do not grant OSM Buildings or other assets until a later gate explicitly requires them.

## Recommended token layout

Use two browser tokens once production deployment exists:

### Local development token

Suggested name: `cas-simulator-local`

- Scopes: `assets:read` only
- Assets: `1` and `2` only
- Allowed URL: `http://127.0.0.1:5173`

The Vite development server is pinned to `127.0.0.1:5173` with `strictPort: true` so this restriction is deterministic.

### Production token

Create only after the Cloudflare deployment URL exists.

Suggested name: `cas-simulator-production`

- Scopes: `assets:read` only
- Assets: `1` and `2` only
- Allowed URL: the exact HTTPS production origin

Do not reuse the local token in production.

## Local configuration

Create `.env.local` from `.env.example` and set:

```text
VITE_CESIUM_ION_TOKEN=<local browser token>
```

Never paste the token into GitHub issues, commits, documentation, screenshots, or chat messages.

## C0 verification

After dependencies are installed:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
```

Acceptance evidence:

- Cesium Earth renders;
- terrain loads without 401/403 token errors;
- global imagery renders;
- diagnostics panel updates;
- browser console has no persistent Cesium authentication errors.

Then run:

```bash
pnpm check
pnpm build
```

C0 is not closed until the Cloudflare production deployment and production-token restriction are also verified.
