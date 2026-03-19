export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  createdAt: Date;
  profile: UserProfile;
  llmProvider: string;
  llmModel: string;
  language: string;
}

export const AGENT_CHARACTERS = [
  "default",
  "drill-sergeant",
  "best-friend",
  "scientist",
  "zen-master",
  "hype-coach",
] as const;

export type AgentCharacter = (typeof AGENT_CHARACTERS)[number];

export const AGENT_CHARACTER_LABELS: Record<AgentCharacter, string> = {
  "default": "Balanced Coach",
  "drill-sergeant": "Drill Sergeant",
  "best-friend": "Best Friend",
  "scientist": "The Scientist",
  "zen-master": "Zen Master",
  "hype-coach": "Hype Coach",
};

export const AGENT_CHARACTER_SET = new Set<string>(AGENT_CHARACTERS);

export interface UserProfile {
  age?: number;
  gender?: string;
  height?: number; // cm
  weight?: number; // kg
  goals?: string[];
  injuries?: string[];
  dietaryRestrictions?: string[];
  fitnessLevel?: "beginner" | "intermediate" | "advanced";
  preferredWorkoutTime?: string;
  equipmentAvailable?: string[];
  agentName?: string;
  agentCharacter?: AgentCharacter;
}
