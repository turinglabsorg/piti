import type { ChatMessage, Memory } from "./message.js";
import type { UserProfile } from "./user.js";

export interface MediaAttachment {
  type: "image" | "video_frames";
  /** Base64-encoded image data (JPEG) */
  data: string[];
  mimeType: string;
  /** Original caption or description */
  caption?: string;
}

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
  media?: MediaAttachment;
}

export interface TokenUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  purpose: "chat" | "classification" | "memory_extraction";
}

export interface AgentResponse {
  reply: string;
  newMemories?: ExtractedMemory[];
  tokenUsage?: TokenUsage[];
}

export interface ExtractedMemory {
  content: string;
  category: string;
}
