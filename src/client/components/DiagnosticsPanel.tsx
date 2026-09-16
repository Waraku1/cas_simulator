import { useState } from "react";
import { C2_RESOURCE_BUDGET } from "../../shared/config";
import { useRuntimeDiagnostics } from "../diagnostics/useRuntimeDiagnostics";

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function DiagnosticsPanel() {
  const diagnostics = useRuntimeDiagnostics();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const fpsClass = diagnostics.fps >= C2_RESOURCE_BUDGET.minimumFps ? "ok" : "warn";
  const averageFpsClass = diagnostics.averageFps >= C2_RESOURCE_BUDGET.targetFps ? "ok" : "warn";
  const minimumFpsClass = diagnostics.minimumFps >= C2_RESOURCE_BUDGET.minimumFps ? "ok" : "warn";
  const transferClass = diagnostics.transferredMiB <= C2_RESOURCE_BUDGET.targetTransferMiBPerPlayerSession
    ? "ok"
    : "warn";
  const progress = Math.min(
    1,
    diagnostics.sessionSeconds / (C2_RESOURCE_BUDGET.benchmarkMinutes * 60),
  );
  const preflightComplete = diagnostics.sessionSeconds >= C2_RESOURCE_BUDGET.preflightMinutes * 60;
  const benchmarkLabel = diagnostics.benchmarkComplete
    ? "30 MIN COMPLETE"
    : preflightComplete
      ? "PREFLIGHT READY"
      : "PREFLIGHT ACTIVE";

  const copyReport = async () => {
    const report = {
      gate: "C2_WORLD_THEATER",
      capturedAt: new Date().toISOString(),
      preflightMinutesTarget: C2_RESOURCE_BUDGET.preflightMinutes,
      preflightComplete,
      benchmarkMinutesTarget: C2_RESOURCE_BUDGET.benchmarkMinutes,
      elapsedActiveSeconds: Number(diagnostics.sessionSeconds.toFixed(1)),
      benchmarkComplete: diagnostics.benchmarkComplete,
      runtimeFrameCapFps: C2_RESOURCE_BUDGET.runtimeFrameCapFps,
      fps: {
        current: Number(diagnostics.fps.toFixed(1)),
        average: Number(diagnostics.averageFps.toFixed(1)),
        minimum: Number(diagnostics.minimumFps.toFixed(1)),
        target: C2_RESOURCE_BUDGET.targetFps,
        minimumTarget: C2_RESOURCE_BUDGET.minimumFps,
        measurement: "Cesium post-render frames during active foreground time",
      },
      network: {
        observedTransferMiB: Number(diagnostics.transferredMiB.toFixed(2)),
        targetObservedTransferMiB: C2_RESOURCE_BUDGET.targetTransferMiBPerPlayerSession,
        resourceCount: diagnostics.resourceCount,
        zeroTransferResourceCount: diagnostics.zeroTransferResourceCount,
        opaqueCrossOriginResourceCount: diagnostics.opaqueCrossOriginResourceCount,
        caveat: "Observed transfer uses PerformanceResourceTiming.transferSize. Cache hits and cross-origin resources without Timing-Allow-Origin can report zero and are not complete bandwidth accounting.",
      },
      usedHeapMiB: diagnostics.usedHeapMiB === null
        ? null
        : Number(diagnostics.usedHeapMiB.toFixed(1)),
    };

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <aside className="diagnostics diagnostics--c2" aria-label="C2 runtime diagnostics">
      <div className="diagnostics__header">
        <div>
          <div className="diagnostics__title">C2 RESOURCE GATE</div>
          <strong>{benchmarkLabel}</strong>
        </div>
        <span>{formatDuration(diagnostics.sessionSeconds)}</span>
      </div>

      <div className="benchmark-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <dl>
        <div><dt>FPS NOW</dt><dd className={fpsClass}>{diagnostics.fps.toFixed(0)}</dd></div>
        <div><dt>FPS AVG</dt><dd className={averageFpsClass}>{diagnostics.averageFps.toFixed(0)}</dd></div>
        <div><dt>FPS MIN</dt><dd className={minimumFpsClass}>{diagnostics.minimumFps.toFixed(0)}</dd></div>
        <div><dt>FRAME CAP</dt><dd>{C2_RESOURCE_BUDGET.runtimeFrameCapFps}</dd></div>
        <div><dt>OBS TRANSFER</dt><dd className={transferClass}>{diagnostics.transferredMiB.toFixed(1)} MiB</dd></div>
        <div><dt>RESOURCES</dt><dd>{diagnostics.resourceCount}</dd></div>
        <div><dt>OPAQUE X-ORIGIN</dt><dd>{diagnostics.opaqueCrossOriginResourceCount}</dd></div>
        {diagnostics.usedHeapMiB !== null && (
          <div><dt>JS HEAP</dt><dd>{diagnostics.usedHeapMiB.toFixed(0)} MiB</dd></div>
        )}
      </dl>

      <p className="diagnostics__caveat">
        Active foreground Cesium render FPS. Transfer is observable timing data, not complete provider bandwidth.
      </p>
      <button className="diagnostics__copy" type="button" onClick={copyReport}>
        {copyState === "copied" ? "REPORT COPIED" : copyState === "failed" ? "COPY FAILED" : "COPY C2 REPORT"}
      </button>
    </aside>
  );
}
