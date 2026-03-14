import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const url = "https://api.kimi.com/coding/v1/chat/completions";

// Try with a system message that forces content output,
// and also try temperature > 0 to disable reasoning
const body = {
  model: "kimi-for-coding",
  temperature: 0.7,
  messages: [
    {
      role: "system",
      content: "You extract facts from conversations and return JSON arrays. Always respond with the JSON directly in your message content."
    },
    {
      role: "user",
      content: `Extract personal facts from this conversation. Return a JSON array of {"content": "fact", "category": "one of: preference/goal/injury/progress/routine/nutrition/health/personal"}. Return [] if nothing to extract.

User: "Io faccio powerlifting, mi alleno in una palestra ben attrezzata e voglio rinforzarmi e contemporaneamente perdere grasso. Ho avuto un problema alle emorroidi e non bevo alcolici."

JSON array:`,
    },
  ],
  max_tokens: 512,
};

async function test() {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
      "User-Agent": "claude-code/0.1.0",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as any;
  console.log("Status:", res.status);
  console.log("Content:", JSON.stringify(data.choices?.[0]?.message?.content));
  console.log("Reasoning:", data.choices?.[0]?.message?.reasoning_content?.slice(0, 300));
}

test();
