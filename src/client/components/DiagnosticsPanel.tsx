import { C0_RESOURCE_BUDGET } from "../../shared/config";
import { useRuntimeDiagnostics } from "../diagnostics/useRuntimeDiagnostics";

export function DiagnosticsPanel() {
  const diagnostics = useRuntimeDiagnostics();
  const fpsClass = diagnostics.fps >= C0_RESOURCE_BUDGET.minimumFps ? "ok" : "warn";

  return (
    <aside className="diagnostics" aria-label="Runtime diagnostics">
      <div className="diagnostics__title">RUNTIME</div>
      <dl>
        <div>
          <dt>FPS</dt>
          <dd className={fpsClass}>{diagnostics.fps.toFixed(0)}</dd>
        </div>
        <div>
          <dt>TRANSFER</dt>
          <dd>{diagnostics.transferredMiB.toFixed(1)} MiB</dd>
        </div>
        <div>
          <dt>RESOURCES</dt>
          <dd>{diagnostics.resourceCount}</dd>
        </div>
      </dl>
    </aside>
  );
}
