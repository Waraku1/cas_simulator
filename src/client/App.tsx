import { Fragment } from "react";
import { FlightRuntime } from "./FlightRuntime";
import { AccessibilityHardening } from "./product/AccessibilityHardening";
import { ProductLive } from "./product/ProductLive";
import { ProductPreview } from "./product/ProductPreview";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const productPreview = params.get("productPreview") === "1";
  const staticPreview = params.get("staticPreview") === "1";
  if (productPreview) {
    return (
      <Fragment>
        <AccessibilityHardening />
        {staticPreview ? <ProductPreview /> : <ProductLive />}
      </Fragment>
    );
  }
  return <FlightRuntime />;
}
