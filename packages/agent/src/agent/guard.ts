import { createLogger } from "@piti/shared";

const logger = createLogger("guard");

const REFUSAL_MESSAGES: Record<string, string> = {
  italian: "Sono PITI, il tuo assistente personal trainer. Posso aiutarti solo con fitness, nutrizione e salute. Chiedimi qualcosa sul tuo allenamento, dieta o benessere!",
  english: "I'm PITI, your personal trainer assistant. I can only help with fitness, nutrition, and health topics. Please ask me something related to your training, diet, or wellness!",
  spanish: "Soy PITI, tu asistente de entrenamiento personal. Solo puedo ayudarte con fitness, nutrición y salud. ¡Pregúntame algo sobre tu entrenamiento, dieta o bienestar!",
  french: "Je suis PITI, ton assistant coach personnel. Je ne peux t'aider qu'en matière de fitness, nutrition et santé. Pose-moi une question sur ton entraînement, ton alimentation ou ton bien-être !",
  german: "Ich bin PITI, dein persönlicher Trainer-Assistent. Ich kann dir nur bei Fitness, Ernährung und Gesundheit helfen. Frag mich etwas zu deinem Training, deiner Ernährung oder deinem Wohlbefinden!",
  portuguese: "Sou o PITI, seu assistente de personal trainer. Só posso ajudar com fitness, nutrição e saúde. Me pergunte algo sobre seu treino, dieta ou bem-estar!",
};

export function getRefusalMessage(language: string): string {
  return REFUSAL_MESSAGES[language.toLowerCase()] || REFUSAL_MESSAGES.english;
}

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
