export interface ChatMessage {
  id: number;
  userId: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

export interface Memory {
  id: number;
  userId: number;
  content: string;
  category: MemoryCategory;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryCategory =
  | "preference"
  | "goal"
  | "injury"
  | "progress"
  | "routine"
  | "nutrition"
  | "health"
  | "personal";
