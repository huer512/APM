type MessageHandler = (prompt: string, message: string) => Promise<string>;

interface HitlState {
  attached: boolean;
  waitingResolverByBatch: Map<string, () => void>;
  messageHandler?: MessageHandler;
}

export class HitlController {
  private readonly runs = new Map<string, HitlState>();

  public setAttached(runId: string, attached: boolean): void {
    const state = this.getOrCreate(runId);
    state.attached = attached;
  }

  public isAttached(runId: string): boolean {
    return this.getOrCreate(runId).attached;
  }

  public registerMessageHandler(runId: string, handler: MessageHandler): void {
    const state = this.getOrCreate(runId);
    state.messageHandler = handler;
  }

  public async sendMessage(runId: string, prompt: string, message: string): Promise<string> {
    const state = this.getOrCreate(runId);
    if (!state.messageHandler) {
      throw new Error(`Run "${runId}" has no active message handler.`);
    }
    return state.messageHandler(prompt, message);
  }

  public async waitForNext(runId: string): Promise<void> {
    await this.waitForBatch(runId, "__default__");
  }

  public async waitForBatch(runId: string, batchKey: string): Promise<void> {
    const state = this.getOrCreate(runId);
    await new Promise<void>((resolve) => {
      state.waitingResolverByBatch.set(batchKey, resolve);
    });
    state.waitingResolverByBatch.delete(batchKey);
  }

  public moveNext(runId: string): void {
    this.moveBatch(runId, "__default__");
  }

  public moveBatch(runId: string, batchKey: string): void {
    const state = this.getOrCreate(runId);
    const resolver = state.waitingResolverByBatch.get(batchKey);
    if (resolver) {
      resolver();
      state.waitingResolverByBatch.delete(batchKey);
    }
  }

  private getOrCreate(runId: string): HitlState {
    const found = this.runs.get(runId);
    if (found) {
      return found;
    }
    const init: HitlState = { attached: false, waitingResolverByBatch: new Map() };
    this.runs.set(runId, init);
    return init;
  }
}
