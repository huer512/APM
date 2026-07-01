import type { Dict } from "../types.js";

export const APM_TOOL_OPS = [
  "help",
  "capabilities",
  "schema.get",
  "context.current",
  "workflow.list",
  "workflow.get",
  "entry.get",
  "stage.get",
  "prompt.get",
  "host.get",
  "run.list",
  "run.current",
  "run.get",
  "run.events",
  "run.messages",
  "run.outputs",
  "run.variables",
  "run.pause",
  "run.resume",
  "run.stop",
  "run.rerun",
  "run.start",
  "run.set_note",
  "run.set_tag",
  "stage_plan.get",
  "stage_plan.update",
  "attach.status",
  "attach.request",
  "attach.release",
  "attach.next",
  "attach.message",
  "system.health",
  "system.limits",
  "daemon.status",
  "config.validate",
  "config.preview_patch",
  "config.apply_patch",
  "control.confirm",
  "control.cancel",
  "audit.write",
] as const;

export type ApmToolOp = (typeof APM_TOOL_OPS)[number];
export type ApmToolPreset = "off" | "inspect" | "control" | "orchestrate" | "admin" | "custom";

const INSPECT_OPS: ApmToolOp[] = [
  "help",
  "capabilities",
  "schema.get",
  "context.current",
  "workflow.list",
  "workflow.get",
  "entry.get",
  "stage.get",
  "prompt.get",
  "host.get",
  "run.list",
  "run.current",
  "run.get",
  "run.events",
  "run.messages",
  "run.outputs",
  "run.variables",
  "system.health",
  "system.limits",
  "daemon.status",
];

const CONTROL_OPS: ApmToolOp[] = [
  ...INSPECT_OPS,
  "run.pause",
  "run.resume",
  "run.stop",
  "run.rerun",
  "run.set_note",
  "run.set_tag",
  "attach.status",
  "attach.request",
  "attach.release",
  "attach.next",
  "attach.message",
  "audit.write",
];

const ORCHESTRATE_OPS: ApmToolOp[] = [
  ...CONTROL_OPS,
  "run.start",
  "stage_plan.get",
  "stage_plan.update",
  "config.validate",
  "config.preview_patch",
];

const ADMIN_OPS: ApmToolOp[] = [
  ...ORCHESTRATE_OPS,
  "config.apply_patch",
  "control.confirm",
  "control.cancel",
];

export function parseApmToolConfig(metadata: Dict): { enabled: boolean; preset: ApmToolPreset; ops: ApmToolOp[] } {
  const rawPreset = String(metadata.apmTools ?? metadata.apm_tools ?? "off").trim().toLowerCase();
  const preset = isPreset(rawPreset) ? rawPreset : "custom";
  const explicitOps = parseOps(metadata.apmOps ?? metadata.apm_ops);
  const presetOps = getPresetOps(preset);
  const ops = explicitOps.length > 0 ? explicitOps : presetOps;
  return {
    enabled: preset !== "off" && ops.length > 0,
    preset,
    ops,
  };
}

export function getPresetOps(preset: ApmToolPreset): ApmToolOp[] {
  switch (preset) {
    case "inspect":
      return uniqueOps(INSPECT_OPS);
    case "control":
      return uniqueOps(CONTROL_OPS);
    case "orchestrate":
      return uniqueOps(ORCHESTRATE_OPS);
    case "admin":
      return uniqueOps(ADMIN_OPS);
    case "custom":
    case "off":
      return [];
  }
}

export function isApmToolOp(value: string): value is ApmToolOp {
  return (APM_TOOL_OPS as readonly string[]).includes(value);
}

function isPreset(value: string): value is ApmToolPreset {
  return ["off", "inspect", "control", "orchestrate", "admin", "custom"].includes(value);
}

function parseOps(value: unknown): ApmToolOp[] {
  const values = Array.isArray(value)
    ? value.map((item) => String(item))
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim());
  return uniqueOps(values.filter(isApmToolOp));
}

function uniqueOps(values: readonly ApmToolOp[]): ApmToolOp[] {
  return [...new Set(values)];
}
