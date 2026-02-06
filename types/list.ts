// Tipos relacionados con listas de leads

export interface LeadList {
  readonly id: number;
  readonly user_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string;
  readonly lead_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ListItem {
  readonly id: number;
  readonly list_id: number;
  readonly lead_id: number;
  readonly added_at: string;
}

// Payload para crear una lista
export interface CreateListPayload {
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
}

// Payload para actualizar una lista
export interface UpdateListPayload {
  readonly name?: string;
  readonly description?: string;
  readonly color?: string;
}

// Payload para agregar leads a una lista
export interface AddToListPayload {
  readonly lead_ids: readonly number[];
}
