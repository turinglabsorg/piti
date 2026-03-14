import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const url = "https://api.kimi.com/coding/v1/chat/completions";

// Approach: frame it as a coding task since kimi-for-coding likes code
const body = {
  model: "kimi-for-coding",
  messages: [
    {
      role: "system",
      content: "You are a data processing function. You receive text and output structured JSON. Output ONLY the raw JSON, nothing else."
    },
    {
      role: "user",
      content: `// Input text to process:
const userMessage = "Io faccio powerlifting, mi alleno in una palestra ben attrezzata e voglio rinforzarmi e contemporaneamente perdere grasso. Ho avuto un problema alle emorroidi e non bevo alcolici.";

// Task: Extract personal facts and return as JSON array
// Schema: { content: string, category: "preference"|"goal"|"injury"|"progress"|"routine"|"nutrition"|"health"|"personal" }
// Output the JSON array:`,
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
  console.log("Content:", data.choices?.[0]?.message?.content);
  console.log("---");
  console.log("Reasoning:", data.choices?.[0]?.message?.reasoning_content?.slice(0, 500));
}

test();
