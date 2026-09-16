# School IT Allowlist Request — CAS Flight Simulator

## Purpose

This is a student CAS software project hosted on Cloudflare Workers. The application is already deployed and passes automated production health checks outside the school network.

## Current symptom

On the school network, Chrome displays:

- `NET::ERR_CERT_AUTHORITY_INVALID`
- a message identifying Fortinet as the application preventing the secure connection

The same development device successfully renders the Cesium Earth client locally, while the deployed `workers.dev` hostname is blocked.

## Exact hostname requested for review

`cas-flight-simulator.heleshiheiheleshihei.workers.dev`

Please review FortiGate logs for this exact hostname in:

- Web Filter
- Application Control
- DNS Filter
- SSL/SSH Inspection

If school policy permits the CAS project, please allow the exact hostname rather than broadly allowing `*.workers.dev`.

## Expected HTTPS endpoints after approval

- `/` — static application shell and Cesium client
- `/api/health` — application health endpoint

No authentication, file sharing, proxying, tunnelling, or general-purpose browsing functionality is required for C0.

## If `workers.dev` is prohibited by policy

A school-approved custom hostname can be used instead. Cloudflare Workers supports a Custom Domain on an approved Cloudflare-managed domain. The project can then update its production URL and Cesium token restriction to that approved hostname.
