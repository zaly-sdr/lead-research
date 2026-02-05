import { createClient } from "@/libs/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types/api";
import type { Search } from "@/types/search";

// GET /api/search/[id] - Obtener estado de una busqueda
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const searchId = parseInt(id, 10);

    if (isNaN(searchId) || searchId <= 0) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "ID de busqueda invalido" },
        { status: 400 }
      );
    }

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

    // Obtener busqueda
    const { data: search, error: searchError } = await supabase
      .from("searches")
      .select("*")
      .eq("id", searchId)
      .single();

    if (searchError || !search) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Busqueda no encontrada" },
        { status: 404 }
      );
    }

    // Verificar que pertenece al usuario
    if (search.user_id !== user.id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "No autorizado" },
        { status: 403 }
      );
    }

    // Obtener estadisticas de leads si la busqueda esta completada
    let leadStats = null;
    if (search.status === "completed") {
      const { data: statsData } = await supabase
        .from("leads")
        .select("relevance_score")
        .eq("search_id", searchId);

      if (statsData && statsData.length > 0) {
        const scores = statsData
          .map((l) => l.relevance_score)
          .filter((s): s is number => s !== null);

        leadStats = {
          total: statsData.length,
          scored: scores.length,
          avgScore:
            scores.length > 0
              ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
              : 0,
          aboveThreshold: scores.filter((s) => s >= 60).length,
          distribution: {
            excellent: scores.filter((s) => s >= 80).length, // 80-100
            good: scores.filter((s) => s >= 60 && s < 80).length, // 60-79
            poor: scores.filter((s) => s < 60).length, // 0-59
          },
        };
      }
    }

    return NextResponse.json<ApiResponse<Search & { leadStats?: typeof leadStats }>>({
      success: true,
      data: {
        ...(search as Search),
        leadStats,
      },
    });
  } catch (error) {
    console.error("Error en GET /api/search/[id]:", error);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
