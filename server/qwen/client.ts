import { QWEN_API_ORIGIN, QWEN_CHAT_COMPLETIONS_PATH, type QwenChatCompletionRequest, type QwenChatCompletionResponse } from "./contracts";
import type { QwenPlanningConfig } from "./config";
import { PlanningError } from "./errors";

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) throw new PlanningError("qwen_output_too_large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new PlanningError("qwen_output_too_large"); }
    chunks.push(result.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function classifyHttp(status: number): PlanningError {
  if (status === 401 || status === 403) return new PlanningError("qwen_authentication_failed");
  if (status === 429) return new PlanningError("qwen_rate_limited");
  if (status >= 500) return new PlanningError("qwen_unavailable");
  return new PlanningError("qwen_malformed_response");
}

export class QwenClient {
  constructor(private readonly config: QwenPlanningConfig,
    private readonly fetchImpl: FetchImplementation = globalThis.fetch.bind(globalThis)) {}

  async createChatCompletion(request: QwenChatCompletionRequest, signal?: AbortSignal): Promise<QwenChatCompletionResponse> {
    const url = `${this.config.apiOrigin}${QWEN_CHAT_COMPLETIONS_PATH}`;
    if (!url.startsWith(QWEN_API_ORIGIN)) throw new PlanningError("qwen_malformed_response");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiKey}`,
            accept: "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (error) {
        if (controller.signal.aborted) throw new PlanningError("qwen_timeout", error);
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (TRANSIENT_NETWORK_CODES.has(code)) throw new PlanningError("qwen_unavailable", error);
        throw new PlanningError("qwen_unavailable", error);
      }
      const body = await boundedBody(response, this.config.maxResponseBytes);
      if (!response.ok) throw classifyHttp(response.status);
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder().decode(body)); }
      catch (error) { throw new PlanningError("qwen_malformed_response", error); }
      if (!parsed || typeof parsed !== "object" || !("choices" in parsed) || !Array.isArray((parsed as { choices: unknown }).choices)) {
        throw new PlanningError("qwen_malformed_response");
      }
      return parsed as QwenChatCompletionResponse;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
