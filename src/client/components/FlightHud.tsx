import type { FlightTelemetry } from "../flight/model";

function formatHeading(value: number) {
  return String(Math.round(value) % 360).padStart(3, "0");
}

export function FlightHud({ telemetry }: { telemetry: FlightTelemetry }) {
  const climbLabel = Math.abs(telemetry.verticalSpeedMps) < 1
    ? "LEVEL"
    : telemetry.verticalSpeedMps > 0
      ? "CLIMB"
      : "DESCENT";

  return (
    <div className="flight-hud" aria-label="Flight HUD">
      <header className="flight-hud__topbar">
        <div className="brand-lockup">
          <span className="brand-lockup__eyebrow">CAS FLIGHT SIMULATOR</span>
          <strong>C1 FLIGHT</strong>
        </div>
        <div className="flight-status">
          <span className="status-dot" aria-hidden="true" />
          LOCAL FLIGHT ACTIVE
        </div>
      </header>

      <div className="cockpit-reference" aria-hidden="true">
        <span className="cockpit-reference__rail cockpit-reference__rail--left" />
        <span className="cockpit-reference__rail cockpit-reference__rail--right" />
        <span className="cockpit-reference__nose" />
      </div>

      <div className="flight-hud__speed tape-card" aria-label="Speed">
        <span className="tape-card__label">SPEED</span>
        <strong>{Math.round(telemetry.speedKph)}</strong>
        <span className="tape-card__unit">KM/H</span>
      </div>

      <div className="flight-hud__altitude tape-card" aria-label="Altitude">
        <span className="tape-card__label">ALT</span>
        <strong>{Math.round(telemetry.altitudeM).toLocaleString()}</strong>
        <span className="tape-card__unit">M</span>
      </div>

      <div className="attitude" aria-hidden="true">
        <div
          className="attitude__ladder"
          style={{ transform: `translateY(${telemetry.pitchDeg * 2}px) rotate(${-telemetry.bankDeg}deg)` }}
        >
          <span className="attitude__line attitude__line--wide" />
          <span className="attitude__line attitude__line--short attitude__line--up" />
          <span className="attitude__line attitude__line--short attitude__line--down" />
        </div>
        <div className="reticle">
          <span className="reticle__left" />
          <span className="reticle__dot" />
          <span className="reticle__right" />
        </div>
      </div>

      <section className="flight-hud__readout" aria-label="Flight state">
        <div>
          <span>HDG</span>
          <strong>{formatHeading(telemetry.headingDeg)}°</strong>
        </div>
        <div>
          <span>PITCH</span>
          <strong>{telemetry.pitchDeg.toFixed(1)}°</strong>
        </div>
        <div>
          <span>BANK</span>
          <strong>{telemetry.bankDeg.toFixed(1)}°</strong>
        </div>
        <div>
          <span>V/S</span>
          <strong>{telemetry.verticalSpeedMps >= 0 ? "+" : ""}{telemetry.verticalSpeedMps.toFixed(0)} M/S</strong>
        </div>
      </section>

      <section className="flight-hud__throttle" aria-label="Throttle">
        <div className="throttle-copy">
          <span>THROTTLE</span>
          <strong>{Math.round(telemetry.throttlePct)}%</strong>
        </div>
        <div className="throttle-track">
          <span style={{ width: `${telemetry.throttlePct}%` }} />
        </div>
      </section>

      <section className="flight-hud__controls" aria-label="Flight controls">
        <span className="control-chip"><kbd>W</kbd><kbd>S</kbd> PITCH</span>
        <span className="control-chip"><kbd>A</kbd><kbd>D</kbd> BANK / TURN</span>
        <span className="control-chip"><kbd>↑</kbd><kbd>↓</kbd> THROTTLE</span>
      </section>

      <div className={`vertical-state vertical-state--${climbLabel.toLowerCase()}`}>
        {climbLabel}
      </div>
    </div>
  );
}
