import type { ChatMessage, Memory } from "./message.js";
import type { UserProfile } from "./user.js";

export interface AgentRequest {
  userId: number;
  telegramId: number;
  message: string;
  conversationHistory: ChatMessage[];
  memories: Memory[];
  userProfile: UserProfile;
  llmProvider: string;
  llmModel: string;
  routerModel: string;
  smartModel: string;
  language: string;
}

export interface AgentResponse {
  reply: string;
  newMemories?: ExtractedMemory[];
}

export interface ExtractedMemory {
  content: string;
  category: string;
}
