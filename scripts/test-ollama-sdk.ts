import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const OLLAMA_API_KEY = "02788eb5f8d440c08bd404dbe881c9d2.fe7915ORO9Xf7p3KHiZLBzja";

async function main() {
console.log("Test 1: createOpenAI with compatibility: compatible");
try {
  const ollama = createOpenAI({
    apiKey: OLLAMA_API_KEY,
    baseURL: "https://ollama.com/v1",
    compatibility: "compatible",
  });

  const result = await generateText({
    model: ollama("gemma3:27b"),
    messages: [{ role: "user", content: "Say hello in Italian, 5 words max" }],
    maxTokens: 20,
  });
  console.log("OK:", result.text);
  console.log("Usage:", result.usage);
} catch (e: any) {
  console.error("FAILED:", e.message);
  if (e.data) console.error("Data:", JSON.stringify(e.data));
  if (e.url) console.error("URL:", e.url);
  if (e.statusCode) console.error("Status:", e.statusCode);
}

console.log("\nTest 2: createOpenAI without compatibility flag");
try {
  const ollama2 = createOpenAI({
    apiKey: OLLAMA_API_KEY,
    baseURL: "https://ollama.com/v1",
  });

  const result2 = await generateText({
    model: ollama2("gemma3:27b"),
    messages: [{ role: "user", content: "Say hello in Italian, 5 words max" }],
    maxTokens: 20,
  });
  console.log("OK:", result2.text);
} catch (e: any) {
  console.error("FAILED:", e.message);
  if (e.data) console.error("Data:", JSON.stringify(e.data));
  if (e.url) console.error("URL:", e.url);
}

console.log("\nTest 3: Direct fetch to classify (same as trainer.ts)");
try {
  const res = await fetch("https://ollama.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gemma3:27b",
      messages: [{ role: "user", content: "Classify: Ciao come stai? Reply SIMPLE" }],
      max_tokens: 10,
    }),
  });
  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Response:", JSON.stringify(data).slice(0, 200));
} catch (e: any) {
  console.error("FAILED:", e.message);
}
}
main();
