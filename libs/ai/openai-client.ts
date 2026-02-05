import type { AICompletionResult, AICompletionOptions } from "./claude-client";

// Stub inicial para OpenAI como fallback
// Se implementara completo cuando se necesite

export async function openaiCompletion(
  options: AICompletionOptions
): Promise<AICompletionResult> {
  const { systemPrompt, userPrompt } = options;

  // TODO: Implementar con el SDK de OpenAI cuando se instale
  // Por ahora lanza error para que el provider sepa que no esta disponible
  throw new Error(
    `OpenAI fallback no implementado. ` +
    `System: ${systemPrompt.slice(0, 50)}... User: ${userPrompt.slice(0, 50)}...`
  );
}

export function isOpenAIAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
