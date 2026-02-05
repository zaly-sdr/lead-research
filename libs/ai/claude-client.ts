import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/libs/utils/retry";

// Interfaz comun para respuestas de IA
export interface AICompletionResult {
  readonly content: string;
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

// Opciones para una llamada a la IA
export interface AICompletionOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY no esta configurada");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    // Reintentar en rate limit (429) y errores del servidor (500+)
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

export async function claudeCompletion(
  options: AICompletionOptions
): Promise<AICompletionResult> {
  const { systemPrompt, userPrompt, maxTokens = 1024, temperature = 0 } = options;

  const response = await withRetry(
    async () => {
      return getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      shouldRetry: isRetryableError,
    }
  );

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude no devolvio contenido de texto");
  }

  return {
    content: textBlock.text,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export function isClaudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
