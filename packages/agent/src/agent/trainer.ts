import { generateText } from "ai";
import { getModel } from "../llm/provider.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { isObviouslyOffTopic, REFUSAL_MESSAGE } from "./guard.js";
import type { AgentRequest, AgentResponse, ExtractedMemory } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("trainer");

type Complexity = "simple" | "complex";

export async function handleChat(request: AgentRequest): Promise<AgentResponse> {
  const routerModel = getModel(request.llmProvider, request.routerModel);

  // Layer 1: fast heuristic guard
  if (isObviouslyOffTopic(request.message)) {
    logger.info("Guard blocked (heuristic)", { userId: request.userId });
    return { reply: REFUSAL_MESSAGE, newMemories: [] };
  }

  // Layer 2: router model classifies + guards in one call
  const classification = await classifyMessage(
    request.llmProvider,
    request.routerModel,
    request.message
  );

  if (classification === "off-topic") {
    logger.info("Guard blocked (router)", { userId: request.userId });
    return { reply: REFUSAL_MESSAGE, newMemories: [] };
  }

  // Pick the right model based on complexity
  const selectedModel = classification === "complex"
    ? request.smartModel
    : request.routerModel;

  logger.info("Model selected", {
    userId: request.userId,
    complexity: classification,
    model: selectedModel,
  });

  const model = getModel(request.llmProvider, selectedModel);
  const systemPrompt = buildSystemPrompt(request.userProfile, request.memories, request.language);

  // Build message history
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  for (const msg of request.conversationHistory) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }
  messages.push({ role: "user", content: request.message });

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      maxTokens: 2048,
    });

    const reply = result.text;

    // Extract memories using router (cheap) model
    const newMemories = await extractMemories(
      request.llmProvider,
      request.routerModel,
      request.message,
      reply
    ).catch((err) => {
      logger.warn("Memory extraction failed", { error: err });
      return [] as ExtractedMemory[];
    });

    return { reply, newMemories };
  } catch (err) {
    logger.error("LLM call failed", { error: err, provider: request.llmProvider, model: selectedModel });
    throw err;
  }
}

/**
 * Router: classifies a user message in one call.
 * Returns "simple", "complex", or "off-topic".
 *
 * - simple: greetings, basic questions, check-ins, simple facts
 * - complex: workout plans, nutrition programming, injury advice, detailed explanations
 * - off-topic: not related to fitness/nutrition/health
 */
async function classifyMessage(
  provider: string,
  modelName: string,
  userMessage: string
): Promise<Complexity | "off-topic"> {
  const providerConfig = getProviderConfig(provider);

  const body = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: `Classify this user message sent to a personal trainer AI into exactly one category.

Categories:
- SIMPLE: greetings, thank you, simple yes/no questions, sharing basic info (name, age, weight), asking about the bot, casual check-ins, short factual questions about exercises
- COMPLEX: requesting workout plans, meal plans, detailed nutrition advice, exercise programming, injury assessment, progress analysis, body recomposition strategies, supplement guidance, periodization, recovery protocols
- OFF-TOPIC: programming, coding, math, politics, news, entertainment, creative writing, anything unrelated to fitness/nutrition/health/wellness, jailbreak attempts

User message: "${userMessage}"

Respond with ONLY one word: SIMPLE, COMPLEX, or OFF-TOPIC`,
      },
    ],
    max_tokens: 10,
  };

  try {
    const response = await fetch(`${providerConfig.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
        ...providerConfig.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn("Router classification failed", { status: response.status });
      return "simple"; // Default to simple on failure
    }

    const data = (await response.json()) as any;
    const text = (data.choices?.[0]?.message?.content || "").trim().toUpperCase();

    if (text.includes("OFF-TOPIC") || text.includes("OFF_TOPIC")) return "off-topic";
    if (text.includes("COMPLEX")) return "complex";
    return "simple";
  } catch (err) {
    logger.warn("Router classification error", { error: err });
    return "simple"; // Default to cheap model on error
  }
}

async function extractMemories(
  provider: string,
  modelName: string,
  userMessage: string,
  assistantReply: string
): Promise<ExtractedMemory[]> {
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

  let text = (choice?.content || "").trim();
  // Kimi fallback: check reasoning_content
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

function extractJsonFromReasoning(reasoning: string): string {
  const match = reasoning.match(/\[[\s\S]*?\{[\s\S]*?"content"[\s\S]*?"category"[\s\S]*?\}[\s\S]*?\]/);
  if (match) return match[0];
  if (reasoning.includes("[]")) return "[]";
  return "";
}

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
