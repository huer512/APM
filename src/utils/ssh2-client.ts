export type Ssh2ClientConstructor = new (...args: any[]) => any;

export function loadSsh2Client(): Ssh2ClientConstructor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("ssh2") as { Client?: Ssh2ClientConstructor };
  if (!mod.Client) {
    throw new Error("ssh2.Client export not found");
  }
  return mod.Client;
}

export function ssh2LoadErrorHint(error: unknown): string {
  const base = `SSH runtime unavailable: failed to load "ssh2". ${String(error)}`;
  if (process.env.APM_BUNDLED === "1") {
    return `${base} Running from SEA binary; ensure ssh2 was bundled into the executable.`;
  }
  if (process.versions.bun) {
    return `${base} Running under Bun runtime; use localhost mode or JS build fallback.`;
  }
  return base;
}
