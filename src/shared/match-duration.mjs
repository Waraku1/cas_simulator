// Fictional match timing: the HP gap is captured once when regulation ends.
export const REGULATION_SECONDS = 5 * 60;
export const MAX_OVERTIME_SECONDS = 5 * 60;
export const MIN_OVERTIME_SECONDS = 60;

export function overtimeSecondsForHpGap(hpGap) {
  const gap = Math.max(0, Math.min(100, Math.floor(Math.abs(hpGap))));
  return Math.max(1, 5 - Math.floor(gap / 10)) * 60;
}
