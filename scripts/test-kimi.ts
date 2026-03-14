import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const KIMI_API_KEY = process.env.KIMI_API_KEY;
if (!KIMI_API_KEY) {
  console.error("KIMI_API_KEY not set in .env");
  process.exit(1);
}

const url = "https://api.kimi.com/coding/v1/chat/completions";

const body = {
  model: "kimi-for-coding",
  messages: [
    { role: "system", content: "You are a helpful assistant. Reply in Italian." },
    { role: "user", content: "Ciao, come stai?" },
  ],
  max_tokens: 256,
};

async function testWithoutHeader() {
  console.log("=== Test WITHOUT User-Agent header ===");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KIMI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

async function testWithHeader() {
  console.log("\n=== Test WITH User-Agent: claude-code/0.1.0 ===");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KIMI_API_KEY}`,
        "User-Agent": "claude-code/0.1.0",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

async function main() {
  await testWithoutHeader();
  await testWithHeader();
}
main();
