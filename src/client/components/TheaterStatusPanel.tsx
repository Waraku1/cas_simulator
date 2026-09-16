import { THEATER } from "../../shared/config";
import type { TheaterStatus } from "../theater/model";

export function TheaterStatusPanel({ status }: { status: TheaterStatus }) {
  const edgeText = status.state === "outside"
    ? `${Math.abs(status.signedEdgeDistanceKm).toFixed(1)} KM OUTSIDE`
    : `${Math.max(0, status.signedEdgeDistanceKm).toFixed(1)} KM TO EDGE`;

  const stateText = status.state === "inside"
    ? "IN BOUNDS"
    : status.state === "warning"
      ? "EDGE WARNING"
      : "OUTSIDE THEATER";

  return (
    <aside
      className={`theater-status theater-status--${status.state}`}
      aria-label="Theater boundary status"
      aria-live={status.state === "inside" ? "off" : "polite"}
    >
      <div className="theater-status__header">
        <span>THEATER</span>
        <strong>{stateText}</strong>
      </div>
      <div className="theater-status__size">{THEATER.widthKm} × {THEATER.heightKm} KM</div>
      <div className="theater-status__edge">{edgeText}</div>
      <div className="theater-status__offset">
        <span>E {status.eastOffsetKm.toFixed(1)} KM</span>
        <span>N {status.northOffsetKm.toFixed(1)} KM</span>
      </div>
    </aside>
  );
}
