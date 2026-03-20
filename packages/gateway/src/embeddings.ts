import { createLogger } from "@piti/shared";

const logger = createLogger("embeddings");

const EMBEDDING_MODEL = "openai/text-embedding-3-small";

let apiKey: string = "";
let baseURL: string = "https://openrouter.ai/api/v1";

export function initEmbeddings(openrouterApiKey: string) {
  apiKey = openrouterApiKey;
}

/**
 * Generate an embedding vector for a text string.
 * Uses OpenRouter's embeddings API with text-embedding-3-small (1536 dimensions).
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!apiKey) {
    logger.warn("Embeddings not configured — no API key");
    return null;
  }

  try {
    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.warn("Embedding API call failed", { status: response.status });
      return null;
    }

    const data = (await response.json()) as {
      data: { embedding: number[] }[];
    };

    return data.data?.[0]?.embedding || null;
  } catch (err) {
    logger.warn("Embedding generation error", { error: err });
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!apiKey || texts.length === 0) return texts.map(() => null);

  try {
    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.warn("Batch embedding API call failed", { status: response.status });
      return texts.map(() => null);
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Map results back by index
    const results: (number[] | null)[] = texts.map(() => null);
    for (const item of data.data) {
      results[item.index] = item.embedding;
    }
    return results;
  } catch (err) {
    logger.warn("Batch embedding error", { error: err });
    return texts.map(() => null);
  }
}
