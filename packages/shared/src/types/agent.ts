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

export interface Skill {
  id: number;
  content: string;
  enabled: boolean;
}

export interface AgentRequest {
  userId: number;
  telegramId: number;
  message: string;
  conversationHistory: ChatMessage[];
  memories: Memory[];
  skills?: Skill[];
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

export interface McpCall {
  server: string;
  tool: string;
  args: Record<string, any>;
  durationMs: number;
}

export interface NewReminder {
  prompt: string;
  delayMinutes: number;
}

export interface AgentResponse {
  reply: string;
  newMemories?: ExtractedMemory[];
  newReminders?: NewReminder[];
  tokenUsage?: TokenUsage[];
  mcpCalls?: McpCall[];
}

export interface ExtractedMemory {
  content: string;
  category: string;
}
