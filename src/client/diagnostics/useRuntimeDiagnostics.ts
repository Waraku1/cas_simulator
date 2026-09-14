import { useEffect, useState } from "react";

export interface RuntimeDiagnostics {
  fps: number;
  transferredMiB: number;
  resourceCount: number;
}

const MEBIBYTE = 1024 * 1024;

function readNetworkUsage(): Pick<RuntimeDiagnostics, "transferredMiB" | "resourceCount"> {
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const bytes = resources.reduce((total, entry) => total + Math.max(0, entry.transferSize), 0);

  return {
    transferredMiB: bytes / MEBIBYTE,
    resourceCount: resources.length,
  };
}

export function useRuntimeDiagnostics(): RuntimeDiagnostics {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>({
    fps: 0,
    transferredMiB: 0,
    resourceCount: 0,
  });

  useEffect(() => {
    let animationFrame = 0;
    let frameCount = 0;
    let sampleStartedAt = performance.now();

    const sample = (now: number) => {
      frameCount += 1;
      const elapsedMs = now - sampleStartedAt;

      if (elapsedMs >= 1000) {
        const network = readNetworkUsage();
        setDiagnostics({
          fps: (frameCount * 1000) / elapsedMs,
          ...network,
        });
        frameCount = 0;
        sampleStartedAt = now;
      }

      animationFrame = requestAnimationFrame(sample);
    };

    animationFrame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return diagnostics;
}
