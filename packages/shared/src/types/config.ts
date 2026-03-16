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
