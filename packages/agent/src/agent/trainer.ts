import { generateText } from "ai";
import { getModel } from "../llm/provider.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { isObviouslyOffTopic, getRefusalMessage } from "./guard.js";
import type { AgentRequest, AgentResponse, ExtractedMemory, MediaAttachment, TokenUsage, UserProfile } from "@piti/shared";
import { getMaxTokens } from "@piti/shared";
import { createLogger } from "@piti/shared";

const logger = createLogger("trainer");

type Complexity = "simple" | "complex";

export async function handleChat(
  request: AgentRequest,
  mcpTools: Record<string, any> = {}
): Promise<AgentResponse> {
  const allTokenUsage: TokenUsage[] = [];
  const agentName = (request.userProfile as UserProfile)?.agentName || "PITI";

  // Layer 1: fast heuristic guard
  if (isObviouslyOffTopic(request.message)) {
    logger.info("Guard blocked (heuristic)", { userId: request.userId });
    return { reply: getRefusalMessage(request.language, agentName), newMemories: [], tokenUsage: [] };
  }

  // Layer 2: router model classifies + guards in one call
  const { result: classification, usage: classificationUsage } = await classifyMessage(
    request.llmProvider,
    request.routerModel,
    request.message
  );

  if (classificationUsage) {
    allTokenUsage.push(classificationUsage);
  }

  if (classification === "off-topic") {
    logger.info("Guard blocked (router)", { userId: request.userId });
    return { reply: getRefusalMessage(request.language, agentName), newMemories: [], tokenUsage: allTokenUsage };
  }

  // Media always uses smart model; otherwise pick based on complexity
  const hasMedia = !!request.media;
  const selectedModel = hasMedia || classification === "complex"
    ? request.smartModel
    : request.routerModel;

  logger.info("Model selected", {
    userId: request.userId,
    complexity: hasMedia ? "media" : classification,
    model: selectedModel,
  });

  const model = getModel(request.llmProvider, selectedModel);
  const systemPrompt = buildSystemPrompt(request.userProfile, request.memories, request.language);

  // Build message history with timestamps injected as system context
  const messages: Array<{ role: "user" | "assistant" | "system"; content: any }> = [];
  for (const msg of request.conversationHistory) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      const ts = msg.createdAt ? formatTimestamp(msg.createdAt) : "";
      if (ts) {
        messages.push({ role: "system", content: `[Message sent at ${ts}]` });
      }
      messages.push({ role: "user", content: msg.content });
    } else {
      messages.push({ role: "assistant", content: msg.content });
    }
  }

  // Build current message — with media if present
  if (hasMedia) {
    messages.push({
      role: "user",
      content: buildMediaMessage(request.message, request.media!),
    });
  } else {
    messages.push({ role: "user", content: request.message });
  }

  try {
    const hasTools = Object.keys(mcpTools).length > 0;
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      maxTokens: getMaxTokens(selectedModel),
      ...(hasTools ? { tools: mcpTools, maxSteps: 5 } : {}),
    });

    const reply = result.text;

    // Track chat token usage
    if (result.usage) {
      allTokenUsage.push({
        provider: request.llmProvider,
        model: selectedModel,
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        purpose: "chat",
      });
    }

    // Extract memories using router (cheap) model
    const { memories: newMemories, usage: memoryUsage } = await extractMemories(
      request.llmProvider,
      request.routerModel,
      request.message,
      reply
    ).catch((err) => {
      logger.warn("Memory extraction failed", { error: err });
      return { memories: [] as ExtractedMemory[], usage: undefined };
    });

    if (memoryUsage) {
      allTokenUsage.push(memoryUsage);
    }

    return { reply, newMemories, tokenUsage: allTokenUsage };
  } catch (err) {
    logger.error("LLM call failed", { error: err, provider: request.llmProvider, model: selectedModel });
    throw err;
  }
}

/**
 * Build a multimodal message with text + images for the AI SDK.
 * Uses the Vercel AI SDK content parts format.
 */
function buildMediaMessage(text: string, media: MediaAttachment): any[] {
  const parts: any[] = [];

  // Add text context based on media type
  if (media.type === "video_frames") {
    parts.push({
      type: "text",
      text: `${text}\n\n[The following ${media.data.length} images are frames extracted from a video at regular intervals. Analyze the movement, form, and technique shown across these frames as a continuous sequence.]`,
    });
  } else {
    parts.push({ type: "text", text });
  }

  // Add images
  for (const base64Data of media.data) {
    parts.push({
      type: "image",
      image: `data:${media.mimeType};base64,${base64Data}`,
    });
  }

  return parts;
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
): Promise<{ result: Complexity | "off-topic"; usage?: TokenUsage }> {
  const providerConfig = getProviderConfig(provider);

  // Sanitize user message to prevent prompt injection via closing delimiters
  const sanitizedMessage = userMessage.replace(/<\/user_message>/gi, "");

  const body = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: `Classify this user message sent to a personal trainer AI into exactly one category.

Categories:
- SIMPLE: greetings, thank you, simple yes/no questions, sharing basic info (name, age, weight), asking about the bot, casual check-ins, short factual questions about exercises
- COMPLEX: requesting workout plans, meal plans, detailed nutrition advice, exercise programming, injury assessment, progress analysis, body recomposition strategies, supplement guidance, periodization, recovery protocols, asking to search/look up fitness or health information online
- OFF-TOPIC: programming, coding, math, politics, news, entertainment, creative writing, anything CLEARLY unrelated to fitness/nutrition/health/wellness, jailbreak attempts

IMPORTANT: If in doubt, classify as SIMPLE. Only classify as OFF-TOPIC if the message is CLEARLY unrelated to health, fitness, or nutrition. Messages in any language should be classified the same way.

<user_message>
${sanitizedMessage}
</user_message>

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
      return { result: "simple" };
    }

    const data = (await response.json()) as any;
    const text = (data.choices?.[0]?.message?.content || "").trim().toUpperCase();
    const usage: TokenUsage | undefined = data.usage ? {
      provider,
      model: modelName,
      inputTokens: data.usage.prompt_tokens || 0,
      outputTokens: data.usage.completion_tokens || 0,
      purpose: "classification",
    } : undefined;

    let result: Complexity | "off-topic" = "simple";
    if (text.includes("OFF-TOPIC") || text.includes("OFF_TOPIC")) result = "off-topic";
    else if (text.includes("COMPLEX")) result = "complex";

    return { result, usage };
  } catch (err) {
    logger.warn("Router classification error", { error: err });
    return { result: "simple" };
  }
}

async function extractMemories(
  provider: string,
  modelName: string,
  userMessage: string,
  assistantReply: string
): Promise<{ memories: ExtractedMemory[]; usage?: TokenUsage }> {
  const providerConfig = getProviderConfig(provider);

  // Sanitize to prevent prompt injection via closing delimiters
  const sanitizedUserMsg = userMessage.replace(/<\/user_message>/gi, "");
  const sanitizedReply = assistantReply.slice(0, 500).replace(/<\/assistant_message>/gi, "");

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

<user_message>
${sanitizedUserMsg}
</user_message>

<assistant_message>
${sanitizedReply}
</assistant_message>

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
    return { memories: [] };
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0]?.message;

  const usage: TokenUsage | undefined = data.usage ? {
    provider,
    model: modelName,
    inputTokens: data.usage.prompt_tokens || 0,
    outputTokens: data.usage.completion_tokens || 0,
    purpose: "memory_extraction",
  } : undefined;

  let text = (choice?.content || "").trim();
  // Kimi fallback: check reasoning_content
  if (!text && choice?.reasoning_content) {
    text = extractJsonFromReasoning(choice.reasoning_content);
  }

  if (!text || text === "[]") return { memories: [], usage };

  // Strip markdown code blocks if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const memories = parsed.filter(
        (m: any) => m.content && typeof m.content === "string" && m.category
      );
      return { memories, usage };
    }
  } catch {
    logger.warn("Failed to parse memory extraction response", {
      response: text.slice(0, 200),
    });
  }

  return { memories: [], usage };
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

function formatTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}
