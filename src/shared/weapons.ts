import catalogJson from "./weapon-catalog.json";
import type { WeaponId, WeaponSpec } from "./product";

export const WEAPON_CATALOG = catalogJson as readonly WeaponSpec[];

const WEAPON_BY_ID = new Map<WeaponId, WeaponSpec>(
  WEAPON_CATALOG.map((weapon) => [weapon.weaponId, weapon] as const),
);

export const DEFAULT_WEAPON_LOADOUT = Object.freeze(["missile", "gun"] as const);

export function weaponById(weaponId: string): WeaponSpec | null {
  return WEAPON_BY_ID.get(weaponId as WeaponId) ?? null;
}

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && WEAPON_BY_ID.has(value as WeaponId);
}

export function weaponReadyAt(
  readyAt: Partial<Record<WeaponId, number>> | null | undefined,
  weaponId: WeaponId,
  legacyReadyAtMs = 0,
) {
  const value = readyAt?.[weaponId];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : legacyReadyAtMs;
}
