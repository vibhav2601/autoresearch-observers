export interface WorkshopRun {
  id: string;
  event_name?: string | null;
  started_at?: number;
  last_updated_at?: number;
  user_id?: string | null;
  metadata?: string | null;
  finished?: number | null;
}

export interface WorkshopSpan {
  id: string;
  parent_span_id?: string | null;
  name?: string | null;
  span_type?: string | null;
  status?: string | null;
  input_payload?: string | null;
  output_payload?: string | null;
  start_time_ms?: number | null;
  end_time_ms?: number | null;
}

export interface WorkshopLiveEvent {
  id: number | string;
  trace_id?: string | null;
  span_id?: string | null;
  type?: string | null;
  timestamp?: number | null;
}

export interface WorkshopRunDetail {
  spans?: WorkshopSpan[];
  liveEvents?: WorkshopLiveEvent[];
}
