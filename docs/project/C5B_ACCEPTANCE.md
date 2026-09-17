# C5B Acceptance Boundary

C5B implementation acceptance requires:

- `pnpm verify:c5b` passes;
- `pnpm check` passes;
- `pnpm build` passes;
- existing C4C/C5A verification remains green;
- existing school-local full-stack smoke remains green;
- no C1-C4 semantic files are modified beyond observational performance instrumentation.

C5B release evidence acceptance additionally requires the human/browser runs in `docs/operations/C5B_PERFORMANCE_EVIDENCE.md`.

A green pull request proves the instrumentation contract is present and build-safe. It does not by itself prove target hardware sustains the required FPS.
