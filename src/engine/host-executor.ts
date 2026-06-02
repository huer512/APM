import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { loadSsh2Client, ssh2LoadErrorHint } from "../utils/ssh2-client.js";
import type { HostDefinition } from "../types.js";

export interface HostRuntime {
  kind: "local" | "ssh";
  workspace: string;
  sshConfig?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    privateKey?: string;
  };
  virtualEnv?: string;
}

export class HostExecutor {
  public async prepare(host: HostDefinition): Promise<HostRuntime> {
    const mustUseSsh = host.port !== undefined || !!host.username || !!host.password || !!host.privateKey;
    const isLocalHost = host.host === "localhost" || host.host === "127.0.0.1";
    if (isLocalHost && !mustUseSsh) {
      await ensureDir(host.workspace);
      return {
        kind: "local",
        workspace: host.workspace,
        virtualEnv: host.virtualEnv,
      };
    }

    await this.ensureRemoteWorkspace(host);
    return {
      kind: "ssh",
      workspace: host.workspace,
      virtualEnv: host.virtualEnv,
      sshConfig: {
        host: host.host,
        port: host.port ?? 22,
        username: host.username,
        password: host.password,
        privateKey: host.privateKey,
      },
    };
  }

  private async ensureRemoteWorkspace(host: HostDefinition): Promise<void> {
    const Client = await loadSsh2ClientForHost();
    const client = new Client();
    const target = host.workspace;
    await new Promise<void>((resolve, reject) => {
      client
        .on("ready", () => {
          const verifyCommand = [
            `mkdir -p ${shellEscapePath(target)}`,
            "command -v node >/dev/null 2>&1",
            "node -e \"require('@cursor/sdk')\" >/dev/null 2>&1",
            "echo APM_REMOTE_READY",
          ].join(" && ");
          client.exec(verifyCommand, (err: Error | undefined, stream: any) => {
            if (err) {
              reject(err);
              return;
            }
            let output = "";
            let stderr = "";
            stream
              .on("data", (chunk: Buffer) => {
                output += chunk.toString("utf8");
              })
              .stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
              });
            stream
              .on("close", () => {
                client.end();
                if (!output.includes("APM_REMOTE_READY")) {
                  reject(
                    new Error(
                      `Failed to prepare remote workspace: ${target}. Ensure remote node and @cursor/sdk are installed. ${stderr}`,
                    ),
                  );
                  return;
                }
                resolve();
              });
          });
        })
        .on("error", reject)
        .connect({
          host: host.host,
          port: host.port ?? 22,
          username: host.username,
          password: host.password,
          privateKey: host.privateKey,
        });
    });
  }
}

function shellEscapePath(input: string): string {
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    return `'${input.replace(/'/g, "'\\''")}'`;
  }
  return `'${input.replace(/'/g, "'\\''")}'`;
}

async function loadSsh2ClientForHost(): Promise<any> {
  try {
    return loadSsh2Client();
  } catch (error) {
    throw new Error(ssh2LoadErrorHint(error));
  }
}
