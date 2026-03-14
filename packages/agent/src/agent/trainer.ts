import { generateText } from "ai";
import { getModel } from "../llm/provider.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { guardResponse } from "./guard.js";
import type { AgentRequest, AgentResponse, ExtractedMemory } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("trainer");

export async function handleChat(request: AgentRequest): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(request.userProfile, request.memories, request.language);
  const model = getModel(request.llmProvider, request.llmModel);

  // Build message history
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

  for (const msg of request.conversationHistory) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: "user", content: request.message });

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      maxTokens: 2048,
    });

    const rawReply = result.text;

    // Post-processing guard: validate response is on-topic
    const { allowed, reply } = await guardResponse(
      model,
      request.message,
      rawReply
    );

    if (!allowed) {
      logger.info("Response blocked by guard", {
        userId: request.userId,
        userMessage: request.message.slice(0, 100),
      });
      // Don't extract memories from blocked conversations
      return { reply, newMemories: [] };
    }

    // Extract memories (only for on-topic conversations)
    const newMemories = await extractMemories(
      request.llmProvider,
      request.llmModel,
      request.message,
      reply
    ).catch((err) => {
      logger.warn("Memory extraction failed", { error: err });
      return [] as ExtractedMemory[];
    });

    return { reply, newMemories };
  } catch (err) {
    logger.error("LLM call failed", { error: err, provider: request.llmProvider });
    throw err;
  }
}

async function extractMemories(
  provider: string,
  modelName: string,
  userMessage: string,
  assistantReply: string
): Promise<ExtractedMemory[]> {
  // Kimi puts structured output in reasoning_content instead of content,
  // so we use a direct fetch call to read both fields from the raw response.
  const providerConfig = getProviderConfig(provider);

  const body = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: `You are a memory extraction system. Given the following conversation exchange between a user and their personal trainer AI, extract any personal facts about the user worth remembering long-term.

Return a JSON array of objects with "content" (the fact) and "category" (one of: preference, goal, injury, progress, routine, nutrition, health, personal).

Only extract concrete, specific facts. Do NOT extract:
- Generic conversation filler
- Things the AI said (only extract user facts)
- Temporary states ("I'm tired today")

If there's nothing worth remembering, return: []

---
User said: "${userMessage}"

Assistant replied: "${assistantReply.slice(0, 500)}"
---

Respond ONLY with the JSON array, no markdown, no explanation.`,
      },
    ],
    max_tokens: 512,
  };

  const response = await fetch(`${providerConfig.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
      ...providerConfig.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    logger.warn("Memory extraction API call failed", { status: response.status });
    return [];
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0]?.message;

  // Try content first, then reasoning_content (Kimi puts JSON there)
  let text = (choice?.content || "").trim();
  if (!text && choice?.reasoning_content) {
    text = extractJsonFromReasoning(choice.reasoning_content);
  }

  if (!text || text === "[]") return [];

  // Strip markdown code blocks if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m: any) => m.content && typeof m.content === "string" && m.category
      );
    }
  } catch {
    logger.warn("Failed to parse memory extraction response", {
      response: text.slice(0, 200),
    });
  }

  return [];
}

/**
 * Extract a JSON array from Kimi's reasoning_content field.
 * The reasoning often contains analysis followed by the JSON result.
 */
function extractJsonFromReasoning(reasoning: string): string {
  // Look for a JSON array pattern in the reasoning
  const match = reasoning.match(/\[[\s\S]*?\{[\s\S]*?"content"[\s\S]*?"category"[\s\S]*?\}[\s\S]*?\]/);
  if (match) return match[0];

  // Try to find an empty array
  if (reasoning.includes("[]")) return "[]";

  return "";
}

/**
 * Get raw API config for direct fetch calls (bypasses AI SDK).
 */
function getProviderConfig(provider: string): {
  baseURL: string;
  apiKey: string;
  headers: Record<string, string>;
} {
  switch (provider) {
    case "claude":
      return {
        baseURL: "https://api.anthropic.com/v1",
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        headers: {},
      };
    case "kimi":
      return {
        baseURL: "https://api.kimi.com/coding/v1",
        apiKey: process.env.KIMI_API_KEY || "",
        headers: { "User-Agent": "claude-code/0.1.0" },
      };
    case "openrouter":
      return {
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY || "",
        headers: {},
      };
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
