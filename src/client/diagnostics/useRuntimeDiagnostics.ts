import { useEffect, useState } from "react";
import { C2_RESOURCE_BUDGET } from "../../shared/config";

export interface RuntimeDiagnostics {
  fps: number;
  averageFps: number;
  minimumFps: number;
  transferredMiB: number;
  resourceCount: number;
  opaqueCrossOriginResourceCount: number;
  zeroTransferResourceCount: number;
  sessionSeconds: number;
  benchmarkComplete: boolean;
  usedHeapMiB: number | null;
}

export interface PerformanceEvidenceSnapshot extends RuntimeDiagnostics {
  capturedAt: string;
  targetFps: number;
  minimumRequiredFps: number;
  targetTransferMiBPerPlayerSession: number;
  targetFpsMet: boolean;
  minimumFpsMet: boolean;
  transferBudgetMet: boolean;
}

const MEBIBYTE = 1024 * 1024;
let renderedFrameCount = 0;

if (typeof performance !== "undefined" && typeof performance.setResourceTimingBufferSize === "function") {
  performance.setResourceTimingBufferSize(C2_RESOURCE_BUDGET.resourceTimingBufferSize);
}

/** Called from Cesium's post-render event so C2 reports actual rendered frames. */
export function recordRenderedFrame() {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    renderedFrameCount += 1;
  }
}

function consumeRenderedFrames() {
  const count = renderedFrameCount;
  renderedFrameCount = 0;
  return count;
}

function readNetworkUsage(): Pick<
  RuntimeDiagnostics,
  "transferredMiB" | "resourceCount" | "opaqueCrossOriginResourceCount" | "zeroTransferResourceCount"
> {
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  let bytes = 0;
  let opaqueCrossOriginResourceCount = 0;
  let zeroTransferResourceCount = 0;

  for (const entry of resources) {
    bytes += Math.max(0, entry.transferSize);
    if (entry.transferSize !== 0) continue;

    zeroTransferResourceCount += 1;
    try {
      if (new URL(entry.name, window.location.href).origin !== window.location.origin) {
        opaqueCrossOriginResourceCount += 1;
      }
    } catch {
      // Keep the entry in the generic zero-transfer count when its URL cannot be parsed.
    }
  }

  return {
    transferredMiB: bytes / MEBIBYTE,
    resourceCount: resources.length,
    opaqueCrossOriginResourceCount,
    zeroTransferResourceCount,
  };
}

function readUsedHeapMiB() {
  const performanceWithMemory = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  const usedBytes = performanceWithMemory.memory?.usedJSHeapSize;
  return typeof usedBytes === "number" && Number.isFinite(usedBytes)
    ? usedBytes / MEBIBYTE
    : null;
}

function publishPerformanceEvidence(diagnostics: RuntimeDiagnostics) {
  if (typeof window === "undefined") return;

  const snapshot: PerformanceEvidenceSnapshot = {
    ...diagnostics,
    capturedAt: new Date().toISOString(),
    targetFps: C2_RESOURCE_BUDGET.targetFps,
    minimumRequiredFps: C2_RESOURCE_BUDGET.minimumFps,
    targetTransferMiBPerPlayerSession: C2_RESOURCE_BUDGET.targetTransferMiBPerPlayerSession,
    targetFpsMet: diagnostics.averageFps >= C2_RESOURCE_BUDGET.targetFps,
    minimumFpsMet: diagnostics.minimumFps >= C2_RESOURCE_BUDGET.minimumFps,
    transferBudgetMet: diagnostics.transferredMiB <= C2_RESOURCE_BUDGET.targetTransferMiBPerPlayerSession,
  };

  (window as Window & { __CAS_PERFORMANCE_EVIDENCE__?: PerformanceEvidenceSnapshot })
    .__CAS_PERFORMANCE_EVIDENCE__ = snapshot;
}

/**
 * C2 measures Cesium render cadence during active foreground time only.
 * Background-tab throttling and long browser suspension are excluded from the
 * benchmark instead of being misclassified as sustained low FPS.
 */
export function useRuntimeDiagnostics(): RuntimeDiagnostics {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>({
    fps: 0,
    averageFps: 0,
    minimumFps: 0,
    transferredMiB: 0,
    resourceCount: 0,
    opaqueCrossOriginResourceCount: 0,
    zeroTransferResourceCount: 0,
    sessionSeconds: 0,
    benchmarkComplete: false,
    usedHeapMiB: null,
  });

  useEffect(() => {
    let timerId = 0;
    let sampleStartedAt = performance.now();
    let activeSeconds = 0;
    let weightedFpsTotal = 0;
    let validSampleSeconds = 0;
    let minimumFps = Number.POSITIVE_INFINITY;
    let started = false;

    const resetSampleWindow = (now: number) => {
      consumeRenderedFrames();
      sampleStartedAt = now;
    };

    const handleVisibilityChange = () => {
      resetSampleWindow(performance.now());
    };

    const sample = () => {
      const now = performance.now();
      const sampleElapsedMs = now - sampleStartedAt;
      const frames = consumeRenderedFrames();

      if (document.visibilityState === "visible" && sampleElapsedMs >= 750 && sampleElapsedMs <= 1_500) {
        const sampleSeconds = sampleElapsedMs / 1_000;
        const fps = frames / sampleSeconds;

        // Ignore initialization before Cesium has rendered its first useful frame.
        if (started || frames > 0) {
          started = true;
          activeSeconds += sampleSeconds;
          weightedFpsTotal += fps * sampleSeconds;
          validSampleSeconds += sampleSeconds;
          minimumFps = Math.min(minimumFps, fps);

          const network = readNetworkUsage();
          const nextDiagnostics: RuntimeDiagnostics = {
            fps,
            averageFps: validSampleSeconds > 0 ? weightedFpsTotal / validSampleSeconds : fps,
            minimumFps: Number.isFinite(minimumFps) ? minimumFps : fps,
            ...network,
            sessionSeconds: activeSeconds,
            benchmarkComplete: activeSeconds >= C2_RESOURCE_BUDGET.benchmarkMinutes * 60,
            usedHeapMiB: readUsedHeapMiB(),
          };
          setDiagnostics(nextDiagnostics);
          publishPerformanceEvidence(nextDiagnostics);
        }
      }

      sampleStartedAt = now;
      timerId = window.setTimeout(sample, 1_000);
    };

    renderedFrameCount = 0;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    timerId = window.setTimeout(sample, 1_000);
    return () => {
      window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      renderedFrameCount = 0;
    };
  }, []);

  return diagnostics;
}
