export const QWEN_API_ORIGIN = "https://dashscope.aliyuncs.com" as const;
export const QWEN_API_ORIGIN_INTL = "https://dashscope-intl.aliyuncs.com" as const;
export const QWEN_API_ORIGINS = [QWEN_API_ORIGIN, QWEN_API_ORIGIN_INTL] as const;
export type QwenApiOrigin = (typeof QWEN_API_ORIGINS)[number];
export const QWEN_CHAT_COMPLETIONS_PATH = "/compatible-mode/v1/chat/completions" as const;

export type QwenChatMessage = Readonly<{ role: "system" | "user" | "assistant"; content: string }>;

export type QwenChatCompletionRequest = Readonly<{
  model: string;
  messages: readonly QwenChatMessage[];
  response_format?: Readonly<{ type: "json_object" }>;
  max_tokens: number;
  temperature: number;
}>;

export type QwenChatCompletionResponse = Readonly<{
  choices: ReadonlyArray<Readonly<{ message: Readonly<{ content: string | null }> }>>;
  usage?: Readonly<{ prompt_tokens?: number; completion_tokens?: number }>;
}>;
