import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function listMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  if (!(await pathExists(root))) {
    return files;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(full);
      }
    }
  }

  files.sort();
  return files;
}

export function stemName(filePath: string): string {
  const ext = path.extname(filePath);
  return path.basename(filePath, ext);
}
