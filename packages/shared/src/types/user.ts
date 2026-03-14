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
}
