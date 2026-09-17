# C5B Changelog

- Reuse the canonical C2 runtime diagnostics collector in product-flight mode through a headless probe.
- Export the latest product performance sample as `window.__CAS_PERFORMANCE_EVIDENCE__` for deterministic evidence capture.
- Add a CI contract verifier for the frozen performance thresholds and instrumentation path.
- Add an operational evidence runbook covering preflight, 30-minute sustained runtime, and two-browser ranked product load.
- Add C5 status documentation separating implemented instrumentation from still-required human/device evidence.

No gameplay or product-authority semantics are changed.
