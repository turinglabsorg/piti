import { readFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AgentCharacter } from "@piti/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENT_FOLDER = resolve(
  process.env.AGENT_FOLDER || join(__dirname, "../../../../agents/personal-trainer")
);

// Load and cache personality labels and descriptions from JSON files
export const personalityLabels: Record<string, Record<AgentCharacter, string>> = JSON.parse(
  readFileSync(join(AGENT_FOLDER, "personalities", "labels.json"), "utf-8")
);

export const personalityDescriptions: Record<string, Record<AgentCharacter, string>> = JSON.parse(
  readFileSync(join(AGENT_FOLDER, "personalities", "descriptions.json"), "utf-8")
);

export function getLabels(lang: string): Record<AgentCharacter, string> {
  return personalityLabels[lang] || personalityLabels.english;
}

export function getDescriptions(lang: string): Record<AgentCharacter, string> {
  return personalityDescriptions[lang] || personalityDescriptions.english;
}
