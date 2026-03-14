import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function getModel(provider: string, model: string): LanguageModel {
  switch (provider) {
    case "claude": {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(model);
    }

    case "kimi": {
      const kimi = createOpenAI({
        apiKey: process.env.KIMI_API_KEY,
        baseURL: "https://api.kimi.com/coding/v1",
        headers: {
          "User-Agent": "claude-code/0.1.0",
        },
      });
      return kimi(model);
    }

    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return openrouter(model);
    }

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
