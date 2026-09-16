import catalogJson from "./action-module-catalog.json";
import type { ActionModuleSpec } from "./product";

export const ACTION_MODULE_CATALOG = catalogJson as readonly ActionModuleSpec[];

const ACTION_MODULE_BY_ID = new Map(
  ACTION_MODULE_CATALOG.map((module) => [module.actionModuleId, module]),
);

export function actionModuleById(actionModuleId: string): ActionModuleSpec | null {
  return ACTION_MODULE_BY_ID.get(actionModuleId) ?? null;
}

export function isActionModuleId(value: unknown): value is string {
  return typeof value === "string" && ACTION_MODULE_BY_ID.has(value);
}
