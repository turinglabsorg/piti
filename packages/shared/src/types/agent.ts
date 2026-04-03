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
  reminders?: ExistingReminder[];
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

export interface ExistingReminder {
  id: number;
  prompt: string;
  type: "once" | "recurring";
  cronExpression?: string;
  scheduledAt?: string;
  nextRunAt?: string;
  enabled: boolean;
}

export interface NewReminder {
  prompt: string;
  type: "once" | "recurring";
  /** For one-shot: minutes from now */
  delayMinutes?: number;
  /** For recurring: cron expression (e.g., "0 * * * *" for every hour) */
  cronExpression?: string;
}

export interface ReminderUpdate {
  id: number;
  prompt?: string;
  cronExpression?: string;
  delayMinutes?: number;
  enabled?: boolean;
}

export interface ReminderDeletion {
  id: number;
}

export interface AgentResponse {
  reply: string;
  newMemories?: ExtractedMemory[];
  newReminders?: NewReminder[];
  reminderUpdates?: ReminderUpdate[];
  reminderDeletions?: ReminderDeletion[];
  tokenUsage?: TokenUsage[];
  mcpCalls?: McpCall[];
}

export interface ExtractedMemory {
  content: string;
  category: string;
}
