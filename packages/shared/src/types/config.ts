export const LLM_PROVIDERS = ["claude", "kimi", "openrouter"] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_MODELS: Record<LLMProvider, string[]> = {
  claude: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  kimi: ["kimi-for-coding", "kimi-k2-thinking-turbo"],
  openrouter: [
    "anthropic/claude-sonnet-4-20250514",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "openai/gpt-4o",
  ],
};

/** Max output tokens per model. Defaults to 8192 if not listed. */
export const MODEL_MAX_TOKENS: Record<string, number> = {
  // Claude
  "claude-sonnet-4-20250514": 16384,
  "claude-haiku-4-5-20251001": 8192,
  // Kimi
  "kimi-for-coding": 8192,
  "kimi-k2-thinking-turbo": 16384,
  // OpenRouter
  "anthropic/claude-sonnet-4-20250514": 16384,
  "google/gemini-2.5-flash": 65536,
  "google/gemini-2.5-pro": 65536,
  "openai/gpt-4o": 16384,
};

export const DEFAULT_MAX_TOKENS = 8192;

export function getMaxTokens(model: string): number {
  return MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;
}
