export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string; organization_id: string; name: string; repository_url: string; created_at: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
      analyses: {
        Row: {
          id: string;
          name: string;
          status: "queued" | "analyzing" | "complete" | "failed";
          created_at: string;
          finished_at: string | null;
          stage: "queued" | "fetching" | "selecting" | "parsing" | "storing" | "labelling" | "complete" | "failed";
          stage_message: string;
          stage_started_at: string;
          error_message: string | null;
          failed_stage: string | null;
          commit_sha: string | null;
          adapter: string | null;
          coverage: unknown;
          coverage_percent: number | null;
          import_count: number | null;
          labelling_error: string | null;
          organization_id: string;
          project_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      files: {
        Row: {
          id: string; analysis_id: string; organization_id: string; path: string;
          folder: string | null; module_id: string | null; kind: string | null;
          line_count: number | null; sha256: string | null;
          fan_in: number | null; fan_out: number | null;
        };
        Insert: never; Update: never; Relationships: [];
      };
      file_roles: {
        Row: {
          id: string; analysis_id: string; organization_id: string; file_id: string; role: string; model: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
      model_cache: {
        Row: {
          organization_id: string; cache_key: string; task: string; model: string; output: unknown; created_at: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
      routes: {
        Row: {
          id: string; analysis_id: string; organization_id: string;
          file_id: string; method: string; path: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
      edges: {
        Row: {
          id: string; analysis_id: string; organization_id: string;
          source_file_id: string; target_file_id: string; kind: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
