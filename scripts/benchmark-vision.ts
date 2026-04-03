import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLLAMA_API_KEY = "02788eb5f8d440c08bd404dbe881c9d2.fe7915ORO9Xf7p3KHiZLBzja";
const BASE_URL = "https://ollama.com/api";

const MODELS = [
  "gemma3:27b",
  "gemma3:12b",
  "qwen3-vl:235b-instruct",
  "kimi-k2.5",
];

// Key frames from the deadlift video (spread across the movement)
const FRAME_DIR = resolve(__dirname, "benchmark-frames");
const KEY_FRAMES = ["frame_003.jpg", "frame_008.jpg", "frame_012.jpg", "frame_016.jpg", "frame_020.jpg", "frame_024.jpg"];

interface VisionTask {
  name: string;
  message: string;
  frames: string[];
}

const TASKS: VisionTask[] = [
  {
    name: "form_analysis",
    message: `Queste immagini sono frame estratti da un video di un esercizio in palestra. Analizza:
1. Quale esercizio sta eseguendo?
2. Valuta la forma e la tecnica: postura della schiena, posizione dei piedi, presa, allineamento
3. Identifica eventuali errori o rischi di infortunio
4. Dai suggerimenti specifici per migliorare l'esecuzione
Sii preciso e tecnico come un personal trainer esperto.`,
    frames: KEY_FRAMES,
  },
  {
    name: "single_frame_analysis",
    message: `Analizza questa foto di un esercizio in palestra. Che esercizio è? La forma è corretta? Cosa miglioreresti?`,
    frames: ["frame_015.jpg"],
  },
  {
    name: "weight_estimation",
    message: `Guarda questa foto in palestra. Riesci a stimare il peso sul bilanciere dai dischi visibili? Descrivi i dischi che vedi e fai una stima del carico totale.`,
    frames: ["frame_005.jpg"],
  },
];

interface BenchmarkResult {
  model: string;
  task: string;
  numFrames: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  responseLength: number;
  response: string;
  error?: string;
}

async function callOllamaVision(
  model: string,
  system: string,
  userContent: string,
  images: string[]
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const messages: any[] = [{ role: "system", content: system }];

  messages.push({
    role: "user",
    content: userContent,
    images,
  });

  const body = { model, messages, stream: false };

  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  return {
    text: data.message?.content || "",
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
  };
}

async function runTask(model: string, task: VisionTask): Promise<BenchmarkResult> {
  const images = task.frames.map((f) => {
    const imgData = readFileSync(resolve(FRAME_DIR, f));
    return imgData.toString("base64");
  });

  const system = `You are PITI, an expert personal trainer AI with deep knowledge of exercise biomechanics.
You analyze exercise form from photos and videos with precision.
Always consider safety first. Reply in the user's language.`;

  const start = performance.now();
  try {
    const result = await callOllamaVision(model, system, task.message, images);
    const latencyMs = Math.round(performance.now() - start);

    return {
      model,
      task: task.name,
      numFrames: task.frames.length,
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
      numFrames: task.frames.length,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      responseLength: 0,
      response: "",
      error: err.message?.slice(0, 300),
    };
  }
}

async function main() {
  console.log("PITI Vision Benchmark — Deadlift Form Analysis");
  console.log("=".repeat(60));
  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(`Tasks: ${TASKS.map((t) => `${t.name} (${t.frames.length} frames)`).join(", ")}`);
  console.log("=".repeat(60) + "\n");

  const results: BenchmarkResult[] = [];

  for (const model of MODELS) {
    console.log(`\n--- ${model} ---`);
    for (const task of TASKS) {
      process.stdout.write(`  ${task.name} (${task.frames.length} frames)... `);
      const result = await runTask(model, task);
      results.push(result);

      if (result.error) {
        console.log(`FAIL: ${result.error.slice(0, 100)}`);
      } else {
        console.log(
          `OK ${result.latencyMs}ms | ${result.inputTokens}+${result.outputTokens} tokens | ${result.responseLength} chars`
        );
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(90));
  console.log("SUMMARY");
  console.log("=".repeat(90));

  const header = ["Model", "Task", "Frames", "Latency", "In Tok", "Out Tok", "Chars", "Status"];
  console.log(header.map((h) => h.padEnd(22)).join(""));
  console.log("-".repeat(header.length * 22));

  for (const r of results) {
    const row = [
      r.model.slice(0, 22),
      r.task.slice(0, 22),
      String(r.numFrames),
      `${r.latencyMs}ms`,
      String(r.inputTokens),
      String(r.outputTokens),
      String(r.responseLength),
      r.error ? "FAIL" : "OK",
    ];
    console.log(row.map((c) => c.padEnd(22)).join(""));
  }

  // Averages
  console.log("\n" + "=".repeat(60));
  console.log("AVERAGES PER MODEL (successful runs only)");
  console.log("=".repeat(60));

  for (const model of MODELS) {
    const ok = results.filter((r) => r.model === model && !r.error);
    const all = results.filter((r) => r.model === model);
    if (ok.length === 0) {
      console.log(`${model}: all failed`);
      continue;
    }
    const avgLatency = Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length);
    const totalIn = ok.reduce((s, r) => s + r.inputTokens, 0);
    const totalOut = ok.reduce((s, r) => s + r.outputTokens, 0);
    console.log(
      `${model}: avg ${avgLatency}ms | ${totalIn} in + ${totalOut} out tokens | ${ok.length}/${all.length} ok`
    );
  }

  // Save full responses
  const responsesPath = resolve(__dirname, "benchmark-vision-responses.md");
  let md = "# PITI Vision Benchmark — Deadlift Form Analysis\n\n";
  md += `Date: ${new Date().toISOString()}\n`;
  md += `Video: tests/media/IMG_5426.MP4 (deadlift)\n\n---\n\n`;

  for (const r of results) {
    md += `## ${r.model} — ${r.task} (${r.numFrames} frames)\n\n`;
    if (r.error) {
      md += `**ERROR**: ${r.error}\n\n`;
    } else {
      md += `*${r.latencyMs}ms | ${r.inputTokens} in + ${r.outputTokens} out tokens*\n\n`;
      md += `${r.response}\n\n`;
    }
    md += "---\n\n";
  }
  writeFileSync(responsesPath, md);
  console.log(`\nFull responses saved to ${responsesPath}`);

  const jsonPath = resolve(__dirname, "benchmark-vision-results.json");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`JSON results saved to ${jsonPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
