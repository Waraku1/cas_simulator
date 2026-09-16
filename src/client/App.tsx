import { FlightRuntime } from "./FlightRuntime";
import { ProductPreview } from "./product/ProductPreview";

export default function App() {
  const productPreview = new URLSearchParams(window.location.search).get("productPreview") === "1";
  return productPreview ? <ProductPreview /> : <FlightRuntime />;
}
