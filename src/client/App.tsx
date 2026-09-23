import { Fragment } from "react";
import { FlightRuntime } from "./FlightRuntime";
import { AccessibilityHardening } from "./product/AccessibilityHardening";
import { ProductLive } from "./product/ProductLive";
import { ProductPreview } from "./product/ProductPreview";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const devFlight = params.get("devFlight") === "1";
  const staticPreview = params.get("staticPreview") === "1";

  if (devFlight) return <FlightRuntime localAircraftId="orbit-a1" peerAircraftId="orbit-a1" />;

  return (
    <Fragment>
      <AccessibilityHardening />
      {staticPreview ? <ProductPreview /> : <ProductLive />}
    </Fragment>
  );
}
