import {
  claudeCompletion,
  isClaudeAvailable,
  type AICompletionOptions,
  type AICompletionResult,
} from "./claude-client";
import { openaiCompletion, isOpenAIAvailable } from "./openai-client";

export type AIProvider = "claude" | "openai";

// Detecta que provider esta disponible (Claude tiene prioridad)
export function getAvailableProvider(): AIProvider | null {
  if (isClaudeAvailable()) return "claude";
  if (isOpenAIAvailable()) return "openai";
  return null;
}

// Ejecuta una completion con fallback automatico
export async function aiCompletion(
  options: AICompletionOptions
): Promise<AICompletionResult> {
  const provider = getAvailableProvider();

  if (!provider) {
    throw new Error(
      "No hay API key de IA configurada. Configura ANTHROPIC_API_KEY o OPENAI_API_KEY."
    );
  }

  // Intentar con el provider primario
  try {
    if (provider === "claude") {
      return await claudeCompletion(options);
    }
    return await openaiCompletion(options);
  } catch (primaryError) {
    // Si el primario falla, intentar con el fallback
    const fallback = provider === "claude" ? "openai" : "claude";
    const fallbackAvailable =
      fallback === "claude" ? isClaudeAvailable() : isOpenAIAvailable();

    if (!fallbackAvailable) {
      throw primaryError;
    }

    console.error(
      `AI provider ${provider} fallo, intentando fallback ${fallback}:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );

    try {
      if (fallback === "claude") {
        return await claudeCompletion(options);
      }
      return await openaiCompletion(options);
    } catch (fallbackError) {
      // Si ambos fallan, lanzar el error del primario
      throw primaryError;
    }
  }
}
