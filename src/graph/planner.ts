import type { StageDefinition } from "../types.js";

export interface StagePlanNode {
  stage: string;
  prompts: string[];
  nextStages: string[];
}

export function createStagePlan(stages: Map<string, StageDefinition>, entryStage: string): StagePlanNode[] {
  const ordered: StagePlanNode[] = [];
  const visited = new Set<string>();

  const walk = (stageName: string): void => {
    if (visited.has(stageName)) {
      return;
    }
    const stage = stages.get(stageName);
    if (!stage) {
      throw new Error(`Missing stage "${stageName}" in graph.`);
    }
    visited.add(stageName);
    ordered.push({
      stage: stage.name,
      prompts: [...stage.prompts],
      nextStages: [...stage.nextStages],
    });
    for (const next of stage.nextStages) {
      walk(next);
    }
  };

  walk(entryStage);
  return ordered;
}
