import type { ApmEventInput } from "../types/events.js";
import type { Dict, RunRecord } from "../types.js";
import { formatToolMessageSummary } from "../logging/format-events.js";
import { interpolateText, createEmptyHistory, pushHistory } from "../templating/interpolate.js";
import type { AgentRunCallbacks } from "./agent-runner.js";
import { HostExecutor } from "./host-executor.js";
import { AgentRunner } from "./agent-runner.js";
import { RunStore } from "../state/run-store.js";
import { HitlController } from "./hitl-controller.js";
import type { WorkflowBundle } from "../config/loaders.js";

export interface WorkflowEngineDeps {
  store: RunStore;
  hostExecutor: HostExecutor;
  runner: AgentRunner;
  hitl: HitlController;
}

export class WorkflowEngine {
  private readonly store: RunStore;
  private readonly hostExecutor: HostExecutor;
  private readonly runner: AgentRunner;
  private readonly hitl: HitlController;

  public constructor(deps: WorkflowEngineDeps) {
    this.store = deps.store;
    this.hostExecutor = deps.hostExecutor;
    this.runner = deps.runner;
    this.hitl = deps.hitl;
  }

  public async execute(bundle: WorkflowBundle, run: RunRecord): Promise<void> {
    const runtime = await this.hostExecutor.prepare(bundle.host);
    const variables: Dict = {
      ...bundle.entry.variables,
      ...run.variables,
    };
    const history = createEmptyHistory();
    let currentStages = [bundle.entry.entry];
    const executedStages = new Set<string>();
    let activeStageForHitl = bundle.entry.entry;
    const entryDescription = interpolateText(bundle.entry.description, {
      variables,
      history,
      source: bundle.entry.path,
    });
    await this.emit(run.id, {
      level: "info",
      kind: "entry",
      data: { description: entryDescription },
    });

    this.hitl.registerMessageHandler(run.id, async (promptName, message) => {
      const latestRun = await this.store.getRun(run.id);
      const stageName = latestRun?.currentStage ?? activeStageForHitl;
      if (!stageName) {
        throw new Error("No current stage.");
      }
      const sessionKey = `${run.id}.${stageName}.${promptName}`;
      const createdAt = new Date().toISOString();
      await this.store.appendMessageHistory(run.id, {
        stage: stageName,
        prompt: promptName,
        role: "user",
        content: message,
        createdAt,
      });
      await this.emit(run.id, {
        level: "info",
        kind: "message",
        stage: stageName,
        prompt: promptName,
        sessionKey,
        data: { role: "user", content: message },
      });
      const output = await this.runner.sendFollowUp(
        sessionKey,
        message,
        runtime,
        "auto",
        variables,
        this.buildRunnerCallbacks(run.id, stageName, promptName, sessionKey),
      );
      await this.store.appendMessageHistory(run.id, {
        stage: stageName,
        prompt: promptName,
        role: "assistant",
        content: output,
        createdAt: new Date().toISOString(),
      });
      await this.emit(run.id, {
        level: "info",
        kind: "hitl",
        stage: stageName,
        prompt: promptName,
        sessionKey,
        data: { action: "follow_up", output },
      });
      return output;
    });

    while (currentStages.length > 0) {
      const nextStageBatch = [...new Set(currentStages)].filter((stageName) => !executedStages.has(stageName));
      currentStages = [];
      if (nextStageBatch.length === 0) {
        break;
      }
      const batchKey = nextStageBatch.sort().join(",");
      await this.store.updateRun(run.id, {
        activeBatch: nextStageBatch,
      });

      const nextCandidates = new Set<string>();
      await Promise.all(
        nextStageBatch.map(async (stageName) => {
          executedStages.add(stageName);
          activeStageForHitl = stageName;
          const stage = bundle.stages.get(stageName);
          if (!stage) {
            throw new Error(`Missing stage "${stageName}".`);
          }
          const stageBody = interpolateText(stage.rawBody, {
            variables,
            history,
            source: stage.path,
          });
          await this.store.updateRun(run.id, {
            currentStage: stageName,
            currentPrompt: undefined,
            status: "running",
            waitingForNext: false,
          });
          await this.emit(run.id, {
            level: "info",
            kind: "stage",
            stage: stageName,
            data: { action: "enter" },
          });
          await this.emit(run.id, {
            level: "debug",
            kind: "stage",
            stage: stageName,
            data: { action: "body", body: stageBody },
          });

          for (const promptName of stage.prompts) {
            const promptDef = bundle.prompts.get(promptName);
            if (!promptDef) {
              throw new Error(`Missing prompt "${promptName}" for stage "${stageName}".`);
            }
            const interpolatedMetadata: Dict = {};
            for (const [metaKey, metaValue] of Object.entries(promptDef.metadata)) {
              if (typeof metaValue === "string") {
                interpolatedMetadata[metaKey] = interpolateText(metaValue, {
                  variables,
                  history,
                  source: `${promptDef.path}#metadata.${metaKey}`,
                });
              } else {
                interpolatedMetadata[metaKey] = metaValue;
              }
            }
            const renderedBody = interpolateText(promptDef.body, {
              variables: {
                ...variables,
                ...interpolatedMetadata,
              },
              history,
              source: promptDef.path,
            });
            const effectiveModel = typeof interpolatedMetadata.model === "string"
              ? interpolatedMetadata.model
              : promptDef.model;
            const sessionKey = `${run.id}.${stageName}.${promptName}`;
            const startedAt = new Date().toISOString();
            await this.store.updateRun(run.id, { currentPrompt: promptName });
            await this.emit(run.id, {
              level: "info",
              kind: "prompt",
              stage: stageName,
              prompt: promptName,
              sessionKey,
              data: { action: "started" },
            });
            await this.store.appendMessageHistory(run.id, {
              stage: stageName,
              prompt: promptName,
              role: "user",
              content: renderedBody,
              createdAt: startedAt,
            });
            await this.emit(run.id, {
              level: "info",
              kind: "message",
              stage: stageName,
              prompt: promptName,
              sessionKey,
              data: { role: "user", content: renderedBody },
            });
            const output = await this.runner.runPrompt(
              sessionKey,
              { ...promptDef, model: effectiveModel, metadata: interpolatedMetadata },
              renderedBody,
              runtime,
              variables,
              this.buildRunnerCallbacks(run.id, stageName, promptName, sessionKey),
            );
            const finishedAt = new Date().toISOString();
            pushHistory(history, stageName, promptName, output);
            await this.store.appendPromptHistory(run.id, {
              stage: stageName,
              prompt: promptName,
              output,
              startedAt,
              finishedAt,
            });
            await this.store.appendMessageHistory(run.id, {
              stage: stageName,
              prompt: promptName,
              role: "assistant",
              content: output,
              createdAt: finishedAt,
            });
            await this.emit(run.id, {
              level: "info",
              kind: "message",
              stage: stageName,
              prompt: promptName,
              sessionKey,
              data: { role: "assistant", content: output },
            });
            await this.emit(run.id, {
              level: "info",
              kind: "prompt",
              stage: stageName,
              prompt: promptName,
              sessionKey,
              data: { action: "completed", output },
            });
          }

          await this.store.updateRun(run.id, { currentPrompt: undefined });

          for (const next of stage.nextStages) {
            nextCandidates.add(next);
          }
        }),
      );

      if (this.hitl.isAttached(run.id)) {
        await this.emit(run.id, {
          level: "info",
          kind: "hitl",
          data: { action: "batch_wait", batchKey },
        });
        await this.store.updateRun(run.id, { status: "paused", waitingForNext: true });
        await this.hitl.waitForBatch(run.id, batchKey);
        await this.store.updateRun(run.id, { status: "running", waitingForNext: false });
      }

      currentStages = [...nextCandidates].filter((stageName) => !executedStages.has(stageName));
    }

    await this.store.updateRun(run.id, {
      status: "finished",
      finishedAt: new Date().toISOString(),
      currentStage: undefined,
      currentPrompt: undefined,
      activeBatch: [],
      waitingForNext: false,
    });
    await this.emit(run.id, {
      level: "info",
      kind: "run",
      data: { action: "finished" },
    });
  }

  private buildRunnerCallbacks(
    runId: string,
    stageName: string,
    promptName: string,
    sessionKey: string,
  ): AgentRunCallbacks {
    return {
      onSdkEvent: async (input) => {
        const recordedEvent = await this.emit(runId, {
          ...input,
          stage: stageName,
          prompt: promptName,
          sessionKey,
        });
        const event = recordedEvent ?? {
          ...input,
          runId,
          stage: stageName,
          prompt: promptName,
          sessionKey,
          ts: input.ts ?? new Date().toISOString(),
        };
        if (event.kind === "tool") {
          const status = String(event.data.status ?? "");
          if (status === "completed" || status === "error") {
            await this.store.appendMessageHistory(runId, {
              stage: stageName,
              prompt: promptName,
              role: "tool",
              content: formatToolMessageSummary(event),
              createdAt: event.ts,
              meta: {
                callId: typeof event.data.callId === "string" ? event.data.callId : undefined,
                toolName: typeof event.data.name === "string" ? event.data.name : undefined,
                status,
              },
            });
          }
        }
        if (event.kind === "thinking") {
          await this.store.appendMessageHistory(runId, {
            stage: stageName,
            prompt: promptName,
            role: "thinking",
            content: String(event.data.text ?? ""),
            createdAt: event.ts,
          });
        }
      },
    };
  }

  private async emit(runId: string, input: Omit<ApmEventInput, "runId">) {
    return this.store.appendEvent(runId, {
      runId,
      ...input,
    });
  }
}
