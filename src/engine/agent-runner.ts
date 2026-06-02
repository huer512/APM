import { parseSkillsEnabled } from "../config/skills.js";
import type { ApmEvent, ApmEventInput } from "../types/events.js";
import type { Dict, PromptDefinition } from "../types.js";
import { isRunningInSea } from "../utils/sea-bootstrap.js";
import { loadSsh2Client, ssh2LoadErrorHint } from "../utils/ssh2-client.js";
import { loadBundledSdk } from "./bundled-sdk.js";
import type { HostRuntime } from "./host-executor.js";

interface AgentSession {
  agent: any;
  model: string;
  cwd: string;
  skillsEnabled: boolean;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface AgentRunCallbacks {
  onSdkEvent?: (event: Omit<ApmEventInput, "runId">) => Promise<void>;
}

export interface AgentRunnerOptions {
  apiKey?: string;
  apiKeyProvider?: () => string | undefined;
  sdkModuleLoader?: () => Promise<any>;
}

export class AgentRunner {
  private readonly configuredApiKey?: string;
  private readonly apiKeyProvider?: () => string | undefined;
  private readonly sdkModuleLoader?: () => Promise<any>;
  private readonly sessions = new Map<string, AgentSession>();
  private sdkModule?: any;

  public constructor(options: AgentRunnerOptions = {}) {
    this.configuredApiKey = options.apiKey;
    this.apiKeyProvider = options.apiKeyProvider;
    this.sdkModuleLoader = options.sdkModuleLoader;
  }

  public async runPrompt(
    sessionKey: string,
    prompt: PromptDefinition,
    renderedPrompt: string,
    runtime: HostRuntime,
    variables: Dict,
    callbacks?: AgentRunCallbacks,
  ): Promise<string> {
    const skillsEnabled = parseSkillsEnabled(prompt.metadata);
    return this.sendMessage(
      sessionKey,
      renderedPrompt,
      runtime,
      prompt.model,
      variables,
      prompt.name,
      skillsEnabled,
      callbacks,
    );
  }

  public async sendFollowUp(
    sessionKey: string,
    message: string,
    runtime: HostRuntime,
    model = "auto",
    variables: Dict = {},
    callbacks?: AgentRunCallbacks,
  ): Promise<string> {
    const existing = this.sessions.get(sessionKey);
    const skillsEnabled = existing?.skillsEnabled ?? false;
    return this.sendMessage(
      sessionKey,
      message,
      runtime,
      model,
      variables,
      "follow-up",
      skillsEnabled,
      callbacks,
    );
  }

  public async closeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of entries) {
      await disposeAgent(entry.agent);
    }
  }

  public async closeByPrefix(prefix: string): Promise<void> {
    const closingKeys = [...this.sessions.keys()].filter((key) => key.startsWith(prefix));
    for (const key of closingKeys) {
      const entry = this.sessions.get(key);
      this.sessions.delete(key);
      if (!entry) {
        continue;
      }
      await disposeAgent(entry.agent);
    }
  }

  private async sendMessage(
    sessionKey: string,
    userText: string,
    runtime: HostRuntime,
    model: string,
    _variables: Dict,
    label: string,
    skillsEnabled: boolean,
    callbacks?: AgentRunCallbacks,
  ): Promise<string> {
    if (runtime.kind === "ssh") {
      const session = await this.getOrCreateSession(sessionKey, model, runtime, skillsEnabled);
      const output = await this.runRemotePrompt(session, userText, runtime, callbacks);
      session.transcript.push({ role: "user", text: userText });
      session.transcript.push({ role: "assistant", text: output });
      return output;
    }

    const session = await this.getOrCreateSession(sessionKey, model, runtime, skillsEnabled);
    try {
      const run = await session.agent.send(userText);
      const streamed = await consumeRunStream(run, callbacks);
      const result = await run.wait();
      if (result.status === "error") {
        throw new Error(`${label} failed with run ${result.id}.`);
      }
      const clean = (streamed.assistantText || extractTextFromRunResult(result)).trim();
      session.transcript.push({ role: "user", text: userText });
      session.transcript.push({ role: "assistant", text: clean });
      return clean;
    } catch (error) {
      const sdk = await this.getSdkModule();
      if (isCursorAgentError(error, sdk?.CursorAgentError)) {
        throw new Error(withBunHint(`Cursor SDK startup failed: ${error.message}`));
      }
      throw new Error(withBunHint(String(error)));
    }
  }

  private async getOrCreateSession(
    key: string,
    model: string,
    runtime: HostRuntime,
    skillsEnabled: boolean,
  ): Promise<AgentSession> {
    const found = this.sessions.get(key);
    if (found) {
      return found;
    }
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error("Cursor API key is required. Set ~/.apm/config.json cursorApiKey or CURSOR_API_KEY.");
    }

    const created: AgentSession = {
      agent: undefined,
      model,
      cwd: runtime.workspace,
      skillsEnabled,
      transcript: [],
    };
    if (runtime.kind === "local") {
      try {
        const sdk = await this.getSdkModule();
        created.agent = await sdk.Agent.create({
          apiKey,
          model: { id: model || "auto" },
          local: {
            cwd: runtime.workspace,
            ...(skillsEnabled ? { settingSources: ["project"] } : {}),
          },
        });
      } catch (error) {
        throw new Error(withBunHint(`Failed to create local Cursor agent: ${String(error)}`));
      }
    }
    this.sessions.set(key, created);
    return created;
  }

  private async getSdkModule(): Promise<any> {
    if (this.sdkModule) {
      return this.sdkModule;
    }
    if (this.sdkModuleLoader) {
      this.sdkModule = await this.sdkModuleLoader();
      return this.sdkModule;
    }
    try {
      if (process.env.APM_BUNDLED === "1") {
        this.sdkModule = loadBundledSdk();
      } else {
        this.sdkModule = await import("@cursor/sdk");
      }
      return this.sdkModule;
    } catch (error) {
      throw new Error(
        withBunHint(
          `Failed to load @cursor/sdk runtime. Ensure dependency is resolvable in this environment. ${String(error)}`,
        ),
      );
    }
  }

  private async runRemotePrompt(
    session: AgentSession,
    userText: string,
    runtime: HostRuntime,
    callbacks?: AgentRunCallbacks,
  ): Promise<string> {
    if (!runtime.sshConfig) {
      throw new Error("SSH runtime missing connection config.");
    }
    const conversation = this.buildConversation(session.transcript, userText);
    const command = this.buildRemoteNodeCommand(session.model, conversation, runtime, session.skillsEnabled);
    const output = await this.execSsh(runtime.sshConfig, command);
    const parsed = this.extractRemoteJson(output.stdout, output.stderr);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    if (parsed.events && callbacks?.onSdkEvent) {
      for (const event of parsed.events) {
        await callbacks.onSdkEvent(event);
      }
    }
    return parsed.output.trim();
  }

  private buildConversation(
    transcript: Array<{ role: "user" | "assistant"; text: string }>,
    nextUserText: string,
  ): string {
    const lines: string[] = [];
    for (const item of transcript) {
      lines.push(`${item.role.toUpperCase()}:\n${item.text}`);
    }
    lines.push(`USER:\n${nextUserText}`);
    return lines.join("\n\n");
  }

  private buildRemoteNodeCommand(
    model: string,
    conversation: string,
    runtime: HostRuntime,
    skillsEnabled: boolean,
  ): string {
    const apiKey = this.resolveApiKey() ?? "";
    const payload = JSON.stringify({
      apiKey,
      model: model || "auto",
      cwd: runtime.workspace,
      conversation,
      virtualEnv: runtime.virtualEnv ?? "",
      skillsEnabled,
    });
    const oneLineScript = [
      "const { Agent } = require('@cursor/sdk');",
      "const input=JSON.parse(process.env.APM_PAYLOAD);",
      "const run=async()=>{",
      "const prompt=['You are continuing an existing conversation transcript.','Respond only with the assistant reply to the last USER turn.','Conversation:','',input.conversation].join('\\n');",
      "const local={cwd:input.cwd};",
      "if(input.skillsEnabled){local.settingSources=['project'];}",
      "await using agent=await Agent.create({apiKey:input.apiKey,model:{id:input.model},local});",
      "const sdkRun=await agent.send(prompt);",
      "let assistantText='';",
      "const events=[];",
      "for await (const msg of sdkRun.stream()){",
      "if(msg.type==='assistant'&&msg.message&&Array.isArray(msg.message.content)){",
      "for(const block of msg.message.content){if(block.type==='text'&&block.text){assistantText+=block.text;}}",
      "}",
      "if(msg.type==='tool_call'){events.push({kind:'tool',level:msg.status==='error'?'error':'info',sdkRunId:msg.run_id,data:{callId:msg.call_id,name:msg.name,status:msg.status,args:msg.args,result:msg.result,truncated:msg.truncated}});}",
      "if(msg.type==='thinking'){events.push({kind:'thinking',level:'debug',sdkRunId:msg.run_id,data:{text:msg.text,durationMs:msg.thinking_duration_ms}});}",
      "}",
      "const result=await sdkRun.wait();",
      "if(result.status==='error'){throw new Error('run failed:'+result.id);}",
      "const out=(assistantText||((result.result??'').toString())).trim();",
      "process.stdout.write('APM_REMOTE_JSON:'+JSON.stringify({ok:true,output:out,events})+'\\n');",
      "};",
      "run().catch((err)=>{process.stdout.write('APM_REMOTE_JSON:'+JSON.stringify({ok:false,error:String(err&&err.message||err)})+'\\n');process.exit(1);});",
    ].join("");
    const activation = runtime.virtualEnv
      ? `if [ -d ${quote(runtime.virtualEnv)} ]; then . ${quote(`${runtime.virtualEnv}/bin/activate`)}; fi; `
      : "";
    return `${activation}APM_PAYLOAD=${quote(payload)} node -e ${quote(oneLineScript)}`;
  }

  private resolveApiKey(): string | undefined {
    const fromProvider = this.apiKeyProvider?.();
    if (fromProvider && fromProvider.trim().length > 0) {
      return fromProvider.trim();
    }
    if (this.configuredApiKey && this.configuredApiKey.trim().length > 0) {
      return this.configuredApiKey.trim();
    }
    if (process.env.CURSOR_API_KEY && process.env.CURSOR_API_KEY.trim().length > 0) {
      return process.env.CURSOR_API_KEY.trim();
    }
    return undefined;
  }

  private async execSsh(
    config: NonNullable<HostRuntime["sshConfig"]>,
    command: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const Client = await loadSsh2ClientForAgent();
    const client = new Client();
    return new Promise((resolve, reject) => {
      client
        .on("ready", () => {
          client.exec(command, (err: Error | undefined, stream: any) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }
            let stdout = "";
            let stderr = "";
            stream
              .on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8");
              })
              .stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
              });
            stream.on("close", () => {
              client.end();
              resolve({ stdout, stderr, code: 0 });
            });
          });
        })
        .on("error", reject)
        .connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          privateKey: config.privateKey,
        });
    });
  }

  private extractRemoteJson(
    stdout: string,
    stderr: string,
  ):
    | { ok: true; output: string; events?: Array<Omit<ApmEventInput, "runId">> }
    | { ok: false; error: string } {
    const lines = `${stdout}\n${stderr}`.split("\n");
    const marker = lines.reverse().find((line) => line.startsWith("APM_REMOTE_JSON:"));
    if (!marker) {
      return { ok: false, error: `Remote execution returned no structured output. stderr=${stderr}` };
    }
    const jsonText = marker.slice("APM_REMOTE_JSON:".length);
    const parsed = JSON.parse(jsonText) as {
      ok: boolean;
      output?: string;
      error?: string;
      events?: Array<Omit<ApmEventInput, "runId">>;
    };
    if (!parsed.ok) {
      return { ok: false, error: parsed.error ?? "Remote execution failed." };
    }
    return { ok: true, output: parsed.output ?? "", events: parsed.events };
  }
}

async function consumeRunStream(
  run: any,
  callbacks?: AgentRunCallbacks,
): Promise<{ assistantText: string }> {
  let assistantText = "";
  if (typeof run.stream !== "function") {
    if (typeof run.text === "function") {
      assistantText = String(await run.text());
    }
    return { assistantText };
  }

  for await (const msg of run.stream()) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          assistantText += block.text;
        }
      }
    }
    if (msg.type === "tool_call" && callbacks?.onSdkEvent) {
      await callbacks.onSdkEvent({
        level: msg.status === "error" ? "error" : "info",
        kind: "tool",
        sdkRunId: msg.run_id,
        data: {
          callId: msg.call_id,
          name: msg.name,
          status: msg.status,
          args: msg.args,
          result: msg.result,
          truncated: msg.truncated,
        },
      });
    }
    if (msg.type === "thinking" && callbacks?.onSdkEvent) {
      await callbacks.onSdkEvent({
        level: "debug",
        kind: "thinking",
        sdkRunId: msg.run_id,
        data: {
          text: msg.text,
          durationMs: msg.thinking_duration_ms,
        },
      });
    }
  }
  return { assistantText };
}

async function disposeAgent(agent: any): Promise<void> {
  if (agent && typeof agent[Symbol.asyncDispose] === "function") {
    await agent[Symbol.asyncDispose]();
  } else if (agent && typeof agent.close === "function") {
    await agent.close();
  }
}

function quote(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`;
}

function withBunHint(message: string): string {
  if (process.versions.bun) {
    return `${message}. Running under Bun runtime; verify @cursor/sdk support for this target and use JS build fallback if needed.`;
  }
  if (process.env.APM_BUNDLED === "1" || isRunningInSea()) {
    return `${message}. Running from SEA binary; verify runtime assets under ~/.apm/runtime/ were extracted successfully.`;
  }
  return message;
}

function isCursorAgentError(error: unknown, CursorAgentErrorCtor?: any): error is { message: string } {
  if (CursorAgentErrorCtor && error instanceof CursorAgentErrorCtor) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.name === "CursorAgentError" || typeof record.isRetryable === "boolean";
}

function extractTextFromRunResult(result: any): string {
  if (!result) {
    return "";
  }
  if (typeof result.result === "string") {
    return result.result;
  }
  if (result.result && typeof result.result === "object") {
    if (typeof result.result.text === "string") {
      return result.result.text;
    }
  }
  return "";
}

async function loadSsh2ClientForAgent(): Promise<any> {
  try {
    return loadSsh2Client();
  } catch (error) {
    throw new Error(ssh2LoadErrorHint(error));
  }
}
