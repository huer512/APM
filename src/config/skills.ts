import type { Dict } from "../types.js";

export function parseSkillsEnabled(metadata: Dict): boolean {
  const value = metadata.skills;
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "1";
  }
  return false;
}
