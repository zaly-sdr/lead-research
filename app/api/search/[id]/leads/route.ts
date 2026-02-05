import { createClient } from "@/libs/supabase/server";
import { leadFiltersSchema } from "@/libs/validators/lead-schema";
import { NextRequest, NextResponse } from "next/server";
import type { ApiResponse } from "@/types/api";
import type { Lead } from "@/types/lead";

interface LeadsResponseData {
  leads: Lead[];
  meta: {
    total: number;
    filtered: number;
    page: number;
    limit: number;
    totalPages: number;
    avgScore: number;
    leadsAboveThreshold: number;
  };
}

// GET /api/search/[id]/leads - Obtener leads de una busqueda con filtros
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

    // Verificar que la busqueda pertenece al usuario
    const { data: search, error: searchError } = await supabase
      .from("searches")
      .select("id, user_id")
      .eq("id", searchId)
      .single();

    if (searchError || !search) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Busqueda no encontrada" },
        { status: 404 }
      );
    }

    if (search.user_id !== user.id) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "No autorizado" },
        { status: 403 }
      );
    }

    // Parsear filtros de query params
    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const validated = leadFiltersSchema.safeParse({
      ...searchParams,
      search_id: searchId,
    });

    if (!validated.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: validated.error.issues[0]?.message ?? "Filtros invalidos" },
        { status: 400 }
      );
    }

    const filters = validated.data;

    // Obtener total de leads sin filtros (para estadisticas)
    const { count: totalCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("search_id", searchId);

    // Construir query con filtros
    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .eq("search_id", searchId);

    // Aplicar filtro de score minimo (default: 60)
    const minScore = filters.min_score ?? 60;
    if (minScore > 0) {
      query = query.gte("relevance_score", minScore);
    }

    // Otros filtros
    if (filters.max_score !== undefined) {
      query = query.lte("relevance_score", filters.max_score);
    }

    if (filters.source) {
      query = query.eq("source", filters.source);
    }

    if (filters.is_favorite !== undefined) {
      query = query.eq("is_favorite", filters.is_favorite);
    }

    if (filters.has_email !== undefined) {
      query = filters.has_email
        ? query.not("email", "is", null)
        : query.is("email", null);
    }

    if (filters.city) {
      query = query.ilike("city", `%${filters.city}%`);
    }

    if (filters.country) {
      query = query.ilike("country", `%${filters.country}%`);
    }

    if (filters.company_industry) {
      query = query.ilike("company_industry", `%${filters.company_industry}%`);
    }

    // Ordenamiento
    const sortOrder = filters.sort_order === "asc" ? true : false;
    query = query.order(filters.sort_by, { ascending: sortOrder, nullsFirst: false });

    // Paginacion
    const offset = (filters.page - 1) * filters.limit;
    query = query.range(offset, offset + filters.limit - 1);

    // Ejecutar query
    const { data: leads, error: leadsError, count: filteredCount } = await query;

    if (leadsError) {
      console.error("Error al obtener leads:", leadsError);
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Error al obtener leads" },
        { status: 500 }
      );
    }

    // Calcular estadisticas
    const { data: statsData } = await supabase
      .from("leads")
      .select("relevance_score")
      .eq("search_id", searchId)
      .not("relevance_score", "is", null);

    const scores = (statsData ?? [])
      .map((l) => l.relevance_score)
      .filter((s): s is number => s !== null);

    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const leadsAboveThreshold = scores.filter((s) => s >= 60).length;

    const response: LeadsResponseData = {
      leads: (leads ?? []) as Lead[],
      meta: {
        total: totalCount ?? 0,
        filtered: filteredCount ?? 0,
        page: filters.page,
        limit: filters.limit,
        totalPages: Math.ceil((filteredCount ?? 0) / filters.limit),
        avgScore,
        leadsAboveThreshold,
      },
    };

    return NextResponse.json<ApiResponse<LeadsResponseData>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("Error en GET /api/search/[id]/leads:", error);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
