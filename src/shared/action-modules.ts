import type { ActionModuleSpec } from "./product";

export const ACTION_MODULE_CATALOG = Object.freeze([
  {
    actionModuleId: "vector-link",
    displayName: "VECTOR LINK",
    heartPointEffect: 12,
    cooldownMs: 4_500,
    activationRadiusM: 240,
    activationProfile: "balanced",
  },
  {
    actionModuleId: "tempo-link",
    displayName: "TEMPO LINK",
    heartPointEffect: 7,
    cooldownMs: 2_500,
    activationRadiusM: 180,
    activationProfile: "close",
  },
  {
    actionModuleId: "focus-link",
    displayName: "FOCUS LINK",
    heartPointEffect: 18,
    cooldownMs: 7_000,
    activationRadiusM: 125,
    activationProfile: "precision",
  },
] satisfies readonly ActionModuleSpec[]);

const ACTION_MODULE_BY_ID = new Map(
  ACTION_MODULE_CATALOG.map((module) => [module.actionModuleId, module]),
);

export function actionModuleById(actionModuleId: string): ActionModuleSpec | null {
  return ACTION_MODULE_BY_ID.get(actionModuleId) ?? null;
}

export function isActionModuleId(value: unknown): value is string {
  return typeof value === "string" && ACTION_MODULE_BY_ID.has(value);
}
