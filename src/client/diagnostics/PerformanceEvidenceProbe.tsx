import { useRuntimeDiagnostics } from "./useRuntimeDiagnostics";

/**
 * Keeps the existing C2 diagnostics collector active in product flight mode
 * without adding visible development UI or changing simulator semantics.
 */
export function PerformanceEvidenceProbe() {
  useRuntimeDiagnostics();
  return null;
}
