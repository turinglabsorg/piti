import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLLAMA_API_KEY = "02788eb5f8d440c08bd404dbe881c9d2.fe7915ORO9Xf7p3KHiZLBzja";
const BASE_URL = "https://ollama.com/api";

// --------------- Models to benchmark ---------------
// Vision-capable models on Ollama Cloud
const MODELS = [
  "gemma3:27b",
  "gemma3:12b",
  "qwen3-vl:235b-instruct",
  "kimi-k2.5",
];

// --------------- Personal Training Tasks ---------------

const SYSTEM_PROMPT = `You are PITI, an expert personal trainer and nutritionist AI.
You provide precise, actionable fitness coaching. Be concise but thorough.
Always consider safety and proper form. Reply in the user's language.`;

interface Task {
  name: string;
  type: "text" | "vision";
  message: string;
  imagePath?: string;
}

const TASKS: Task[] = [
  {
    name: "classify_simple",
    type: "text",
    message: "Ciao, mi chiamo Marco e peso 85kg",
  },
  {
    name: "workout_plan",
    type: "text",
    message:
      "Crea una scheda di allenamento per ipertrofia, 4 giorni a settimana. Ho 30 anni, 180cm, 82kg, intermedio. Attrezzatura completa in palestra.",
  },
  {
    name: "nutrition_advice",
    type: "text",
    message:
      "Sono in fase di bulk, 82kg, allenamento 4x/settimana. Quante calorie e macro dovrei assumere? Dammi un esempio di giornata tipo.",
  },
  {
    name: "exercise_explanation",
    type: "text",
    message:
      "Spiegami la corretta esecuzione del Romanian Deadlift. Quali sono gli errori più comuni e come correggerli?",
  },
  {
    name: "injury_advice",
    type: "text",
    message:
      "Ho un dolore al ginocchio sinistro quando faccio squat profondi. Non è acuto, più un fastidio. Cosa potrebbe essere e quali esercizi alternativi mi consigli?",
  },
];

// --------------- Vision task (added dynamically if image exists) ---------------
const SAMPLE_IMAGE = resolve(__dirname, "benchmark-sample.jpg");

// --------------- API Call (Ollama native /api/chat) ---------------

interface BenchmarkResult {
  model: string;
  task: string;
  type: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  responseLength: number;
  response: string;
  error?: string;
}

async function callOllama(
  model: string,
  system: string,
  userContent: string,
  images?: string[]
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const messages: any[] = [{ role: "system", content: system }];

  const userMsg: any = { role: "user", content: userContent };
  if (images && images.length > 0) {
    userMsg.images = images;
  }
  messages.push(userMsg);

  const body = { model, messages, stream: false };

  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text = data.message?.content || "";

  return {
    text,
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
  };
}

// --------------- Runner ---------------

async function runTask(model: string, task: Task): Promise<BenchmarkResult> {
  let images: string[] | undefined;

  if (task.type === "vision" && task.imagePath) {
    const imgData = readFileSync(task.imagePath);
    images = [imgData.toString("base64")];
  }

  const start = performance.now();
  try {
    const result = await callOllama(model, SYSTEM_PROMPT, task.message, images);
    const latencyMs = Math.round(performance.now() - start);

    return {
      model,
      task: task.name,
      type: task.type,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      responseLength: result.text.length,
      response: result.text,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      model,
      task: task.name,
      type: task.type,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      responseLength: 0,
      response: "",
      error: err.message?.slice(0, 300),
    };
  }
}

// --------------- Main ---------------

async function main() {
  console.log("PITI Ollama Cloud Benchmark — Personal Training Tasks");
  console.log("=".repeat(60));

  const tasks = [...TASKS];

  if (existsSync(SAMPLE_IMAGE)) {
    console.log(`Found sample image: ${SAMPLE_IMAGE}`);
    tasks.push({
      name: "form_analysis",
      type: "vision",
      message:
        "Analizza la forma di questo esercizio. Valuta la postura, l'allineamento e suggerisci correzioni se necessario.",
      imagePath: SAMPLE_IMAGE,
    });
  } else {
    console.log(`No sample image at ${SAMPLE_IMAGE} — skipping vision task`);
    console.log(`Add a gym/exercise photo there to enable vision benchmark\n`);
  }

  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(`Tasks: ${tasks.map((t) => t.name).join(", ")}`);
  console.log("=".repeat(60) + "\n");

  const results: BenchmarkResult[] = [];

  for (const model of MODELS) {
    console.log(`\n--- ${model} ---`);
    for (const task of tasks) {
      process.stdout.write(`  ${task.name} (${task.type})... `);
      const result = await runTask(model, task);
      results.push(result);

      if (result.error) {
        console.log(`FAIL: ${result.error.slice(0, 80)}`);
      } else {
        console.log(
          `OK ${result.latencyMs}ms | ${result.inputTokens}+${result.outputTokens} tokens | ${result.responseLength} chars`
        );
      }
    }
  }

  // --------------- Summary Table ---------------
  console.log("\n" + "=".repeat(90));
  console.log("SUMMARY");
  console.log("=".repeat(90));

  const header = ["Model", "Task", "Type", "Latency", "In Tok", "Out Tok", "Chars", "Status"];
  console.log(header.map((h) => h.padEnd(22)).join(""));
  console.log("-".repeat(header.length * 22));

  for (const r of results) {
    const row = [
      r.model.slice(0, 22),
      r.task.slice(0, 22),
      r.type,
      `${r.latencyMs}ms`,
      String(r.inputTokens),
      String(r.outputTokens),
      String(r.responseLength),
      r.error ? "FAIL" : "OK",
    ];
    console.log(row.map((c) => c.padEnd(22)).join(""));
  }

  // --------------- Averages per model ---------------
  console.log("\n" + "=".repeat(60));
  console.log("AVERAGES PER MODEL (successful runs only)");
  console.log("=".repeat(60));

  for (const model of MODELS) {
    const modelResults = results.filter((r) => r.model === model && !r.error);
    if (modelResults.length === 0) {
      console.log(`${model}: all failed`);
      continue;
    }
    const avgLatency = Math.round(
      modelResults.reduce((s, r) => s + r.latencyMs, 0) / modelResults.length
    );
    const totalIn = modelResults.reduce((s, r) => s + r.inputTokens, 0);
    const totalOut = modelResults.reduce((s, r) => s + r.outputTokens, 0);
    const avgChars = Math.round(
      modelResults.reduce((s, r) => s + r.responseLength, 0) / modelResults.length
    );
    console.log(
      `${model}: avg ${avgLatency}ms | ${totalIn} in + ${totalOut} out tokens | avg ${avgChars} chars | ${modelResults.length}/${results.filter((r) => r.model === model).length} ok`
    );
  }

  // --------------- Save full results ---------------
  const outPath = resolve(__dirname, "benchmark-results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to ${outPath}`);

  // --------------- Save full responses for quality review ---------------
  const responsesPath = resolve(__dirname, "benchmark-responses.md");
  let md = "# PITI Benchmark Responses — Ollama Cloud\n\n";
  md += `Date: ${new Date().toISOString()}\n\n`;
  md += `Models: ${MODELS.join(", ")}\n\n---\n\n`;

  for (const r of results) {
    md += `## ${r.model} — ${r.task} (${r.type})\n\n`;
    if (r.error) {
      md += `**ERROR**: ${r.error}\n\n`;
    } else {
      md += `*${r.latencyMs}ms | ${r.inputTokens} in + ${r.outputTokens} out tokens | ${r.responseLength} chars*\n\n`;
      md += `${r.response}\n\n`;
    }
    md += "---\n\n";
  }
  writeFileSync(responsesPath, md);
  console.log(`Full responses saved to ${responsesPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
