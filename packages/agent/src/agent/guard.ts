import { createLogger } from "@piti/shared";

const logger = createLogger("guard");

export const REFUSAL_MESSAGE =
  "I'm PITI, your personal trainer assistant. I can only help with fitness, nutrition, and health topics. Please ask me something related to your training, diet, or wellness!";

/**
 * Fast heuristic for obviously off-topic requests.
 * Catches common jailbreak patterns and clearly unrelated topics.
 */
export function isObviouslyOffTopic(message: string): boolean {
  const lower = message.toLowerCase();

  // Jailbreak / prompt injection patterns
  const jailbreakPatterns = [
    "ignore your instructions",
    "ignore previous instructions",
    "ignore all instructions",
    "ignore your system prompt",
    "forget your rules",
    "you are now",
    "pretend you are",
    "act as if you",
    "new persona",
    "developer mode",
    "dan mode",
    "jailbreak",
    "do anything now",
    "override your",
    "bypass your",
  ];

  if (jailbreakPatterns.some((p) => lower.includes(p))) {
    return true;
  }

  // Obviously off-topic requests (code, math, etc.)
  const offTopicPatterns = [
    /\b(?:write|code|build|create|make)\b.*\b(?:python|javascript|typescript|html|css|sql|script|program|app|website)\b/,
    /\b(?:solve|calculate|compute)\b.*\b(?:math|equation|integral|derivative|algebra)\b/,
    /\b(?:explain|tell me about)\b.*\b(?:quantum|blockchain|cryptocurrency|politics|economics)\b/,
    /\b(?:write|compose|create)\b.*\b(?:poem|story|essay|song|novel|fiction)\b/,
    /\b(?:translate|convert)\b.*\b(?:text|sentence|paragraph|language)\b.*\b(?:to|into)\b/,
  ];

  if (offTopicPatterns.some((p) => p.test(lower))) {
    return true;
  }

  return false;
}
