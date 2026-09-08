export type OutcomeLearningCategory = "growth" | "operations" | "intelligence" | "workspace";

export type OutcomeLearningCategoryLabels = Record<OutcomeLearningCategory, string>;

export function outcomeLearningCategoryForModule(module: string | null | undefined): OutcomeLearningCategory {
  const normalized = (module ?? "").trim().toLowerCase();
  if (normalized === "growth" || normalized === "growth & revenue") return "growth";
  if (normalized === "operations" || normalized === "business insights" || normalized === "business intelligence & operating memory") return "operations";
  if (normalized === "intelligence" || normalized === "brand communications & pr") return "intelligence";
  return "workspace";
}

export function groupOutcomeLearnings<T extends { module: string }>(learnings: readonly T[]): Record<OutcomeLearningCategory, T[]> {
  const groups: Record<OutcomeLearningCategory, T[]> = { growth: [], operations: [], intelligence: [], workspace: [] };
  for (const learning of learnings) groups[outcomeLearningCategoryForModule(learning.module)].push(learning);
  return groups;
}

export function outcomeLearningCategoryLabels(locale: "en" | "zh-Hant"): OutcomeLearningCategoryLabels {
  return locale === "zh-Hant"
    ? { growth: "增長與收入", operations: "商業洞察", intelligence: "品牌傳訊與公關", workspace: "工作空間" }
    : { growth: "Growth & Revenue", operations: "Business Insights", intelligence: "Brand Communications & PR", workspace: "Workspace" };
}

export const OUTCOME_LEARNING_CATEGORY_ORDER: readonly OutcomeLearningCategory[] = ["growth", "operations", "intelligence", "workspace"];
