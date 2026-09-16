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

const MEBIBYTE = 1024 * 1024;

if (typeof performance !== "undefined" && typeof performance.setResourceTimingBufferSize === "function") {
  performance.setResourceTimingBufferSize(C2_RESOURCE_BUDGET.resourceTimingBufferSize);
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

/**
 * C2 measures active foreground cadence only. Background-tab throttling or
 * long browser suspension is excluded from the benchmark rather than being
 * misclassified as sustained low FPS.
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
    let animationFrame = 0;
    let frameCount = 0;
    let sampleStartedAt = performance.now();
    let activeSeconds = 0;
    let weightedFpsTotal = 0;
    let validSampleSeconds = 0;
    let minimumFps = Number.POSITIVE_INFINITY;

    const resetSampleWindow = (now: number) => {
      frameCount = 0;
      sampleStartedAt = now;
    };

    const handleVisibilityChange = () => {
      resetSampleWindow(performance.now());
    };

    const sample = (now: number) => {
      if (document.visibilityState !== "visible") {
        resetSampleWindow(now);
        animationFrame = requestAnimationFrame(sample);
        return;
      }

      frameCount += 1;
      const sampleElapsedMs = now - sampleStartedAt;

      if (sampleElapsedMs >= 1_000) {
        const sampleSeconds = sampleElapsedMs / 1_000;
        const fps = frameCount / sampleSeconds;

        // Windows above 1.5 s usually indicate tab suspension or a scheduling
        // interruption; exclude them from performance evidence.
        if (sampleElapsedMs <= 1_500) {
          activeSeconds += sampleSeconds;
          weightedFpsTotal += fps * sampleSeconds;
          validSampleSeconds += sampleSeconds;
          minimumFps = Math.min(minimumFps, fps);

          const network = readNetworkUsage();
          setDiagnostics({
            fps,
            averageFps: validSampleSeconds > 0 ? weightedFpsTotal / validSampleSeconds : fps,
            minimumFps: Number.isFinite(minimumFps) ? minimumFps : fps,
            ...network,
            sessionSeconds: activeSeconds,
            benchmarkComplete: activeSeconds >= C2_RESOURCE_BUDGET.benchmarkMinutes * 60,
            usedHeapMiB: readUsedHeapMiB(),
          });
        }

        resetSampleWindow(now);
      }

      animationFrame = requestAnimationFrame(sample);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    animationFrame = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return diagnostics;
}
