// A stylized visible game tracer: perspective projection plus a small floor
// keeps distant projectiles visible without changing contact geometry.
export function gunProjectilePixelSize(distanceM, viewportHeightPx, verticalFovRad) {
  const distance = Math.max(1, Number.isFinite(distanceM) ? distanceM : 1);
  const height = Math.max(1, Number.isFinite(viewportHeightPx) ? viewportHeightPx : 1);
  const fov = Number.isFinite(verticalFovRad) && verticalFovRad > 0 && verticalFovRad < Math.PI
    ? verticalFovRad : Math.PI / 3;
  const projectedDiameterPx = 3 * height / (2 * distance * Math.tan(fov / 2));
  return Math.min(18, Math.max(3, projectedDiameterPx));
}
