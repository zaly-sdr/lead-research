import { createClient } from "@/libs/supabase/server";
import { parseSearchQuery } from "@/libs/ai/query-parser";
import { createSearchSchema } from "@/libs/validators/search-schema";
import { executeFullSearch } from "@/libs/services/search-executor";
import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types/api";
import type { Search, ParsedSearchParams } from "@/types/search";

// POST /api/search - Crear nueva busqueda, parsear consulta con IA y ejecutar
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Verificar autenticacion
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "No autorizado" },
        { status: 401 }
      );
    }

    // Validar body
    const body = await req.json();
    const validated = createSearchSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: validated.error.issues[0]?.message ?? "Datos invalidos" },
        { status: 400 }
      );
    }

    const { raw_query } = validated.data;

    // Crear registro de busqueda en estado 'parsing'
    const { data: search, error: insertError } = await supabase
      .from("searches")
      .insert({
        user_id: user.id,
        raw_query,
        status: "parsing",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError || !search) {
      console.error("Error al crear busqueda:", insertError);
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Error al crear la busqueda" },
        { status: 500 }
      );
    }

    // Parsear consulta con IA
    let parsedParams: ParsedSearchParams;
    try {
      const result = await parseSearchQuery(raw_query);
      parsedParams = result.parsedParams;

      // Actualizar busqueda con parametros parseados
      await supabase
        .from("searches")
        .update({
          parsed_params: parsedParams,
          status: "searching",
        })
        .eq("id", search.id);
    } catch (aiError) {
      // Si la IA falla, marcar busqueda como fallida
      await supabase
        .from("searches")
        .update({
          status: "failed",
          error_message:
            aiError instanceof Error ? aiError.message : "Error al parsear consulta",
        })
        .eq("id", search.id);

      console.error("Error al parsear consulta con IA:", aiError);
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Error al analizar la consulta. Intenta con otra busqueda.",
        },
        { status: 500 }
      );
    }

    // Ejecutar busqueda completa (Google Places + LinkedIn + Scoring)
    // NOTA: Esto se ejecuta de forma sincrona. Para busquedas largas,
    // considerar usar background jobs (ej: Vercel Functions con waitUntil)
    const searchResult = await executeFullSearch({
      searchId: search.id,
      userId: user.id,
      parsedParams,
    });

    // Obtener busqueda actualizada
    const { data: updatedSearch } = await supabase
      .from("searches")
      .select()
      .eq("id", search.id)
      .single();

    return NextResponse.json<ApiResponse<Search & { searchStats?: typeof searchResult.stats }>>({
      success: searchResult.success,
      data: {
        ...(updatedSearch as Search),
        searchStats: searchResult.stats,
      },
      error: searchResult.errors.length > 0 ? searchResult.errors.join("; ") : undefined,
    });
  } catch (error) {
    console.error("Error en POST /api/search:", error);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
