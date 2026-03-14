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
  const model = getModel(provider, modelName);

  const result = await generateText({
    model,
    system: `You are a memory extraction system. Given a conversation exchange between a user and their personal trainer AI, extract any personal facts worth remembering long-term.

Return a JSON array of objects with "content" (the fact) and "category" (one of: preference, goal, injury, progress, routine, nutrition, health, personal).

Only extract concrete, specific facts. Do NOT extract:
- Generic conversation filler
- Things the AI said (only extract user facts)
- Temporary states ("I'm tired today")

If there's nothing worth remembering, return an empty array: []

RESPOND ONLY WITH THE JSON ARRAY, no other text.`,
    messages: [
      {
        role: "user",
        content: `User said: "${userMessage}"\n\nAssistant replied: "${assistantReply}"`,
      },
    ],
    maxTokens: 512,
  });

  try {
    const parsed = JSON.parse(result.text.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m: any) => m.content && typeof m.content === "string" && m.category
      );
    }
  } catch {
    logger.warn("Failed to parse memory extraction response", {
      response: result.text,
    });
  }

  return [];
}
