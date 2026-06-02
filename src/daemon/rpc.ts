import net from "node:net";

export interface RpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function encodeRpc(data: RpcRequest | RpcResponse): string {
  return `${JSON.stringify(data)}\n`;
}

export function decodeRpcLines(buffer: string): { messages: RpcRequest[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const messages: RpcRequest[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as RpcRequest;
    messages.push(parsed);
  }
  return { messages, rest };
}

export async function rpcCall<T>(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buf = "";
    socket.on("connect", () => {
      socket.write(
        encodeRpc({
          id,
          method,
          params,
        }),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const response = JSON.parse(line) as RpcResponse;
        if (response.id !== id) {
          continue;
        }
        socket.end();
        if (!response.ok) {
          reject(new Error(response.error ?? "Unknown RPC error"));
          return;
        }
        resolve(response.result as T);
      }
    });
    socket.on("error", reject);
  });
}
