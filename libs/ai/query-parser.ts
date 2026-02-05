import { aiCompletion } from "./provider";
import {
  PARSE_QUERY_SYSTEM_PROMPT,
  buildParseQueryUserPrompt,
} from "./prompts/parse-query";
import {
  parsedSearchParamsSchema,
  type ParsedSearchParamsInput,
} from "@/libs/validators/search-schema";
import type { AICompletionResult } from "./claude-client";

export interface QueryParseResult {
  readonly parsedParams: ParsedSearchParamsInput;
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

function extractJSON(text: string): string {
  // Intentar extraer JSON de bloques de codigo markdown si la IA lo envuelve
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // Si no hay bloque de codigo, asumir que todo es JSON
  return text.trim();
}

export async function parseSearchQuery(
  rawQuery: string
): Promise<QueryParseResult> {
  const userPrompt = buildParseQueryUserPrompt(rawQuery);

  let response: AICompletionResult;
  try {
    response = await aiCompletion({
      systemPrompt: PARSE_QUERY_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1024,
      temperature: 0,
    });
  } catch (error) {
    throw new Error(
      `Error al llamar a la IA para parsear la consulta: ${
        error instanceof Error ? error.message : "Error desconocido"
      }`
    );
  }

  // Extraer y parsear JSON de la respuesta
  const jsonString = extractJSON(response.content);
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(jsonString);
  } catch {
    throw new Error(
      `La IA no devolvio JSON valido. Respuesta: ${response.content.slice(0, 200)}`
    );
  }

  // Validar con Zod
  const validated = parsedSearchParamsSchema.safeParse(rawParsed);
  if (!validated.success) {
    throw new Error(
      `La IA devolvio JSON con formato invalido: ${validated.error.message}`
    );
  }

  return {
    parsedParams: validated.data,
    model: response.model,
    usage: response.usage,
  };
}
