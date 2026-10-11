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
          // GitHub's own answer, recorded when read with the organization's token.
          private: boolean;
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
      model_keys: {
        // ciphertext is readable only with the server key; user tokens get the other four.
        Row: {
          organization_id: string; provider: string; ciphertext: string; last_four: string; updated_at: string;
        };
        Insert: { organization_id: string; provider: string; ciphertext: string; last_four: string; updated_at?: string };
        Update: { provider?: string; ciphertext?: string; last_four?: string; updated_at?: string };
        Relationships: [];
      };
      github_tokens: {
        // ciphertext is readable only with the server key; user tokens get the rest.
        Row: {
          organization_id: string; ciphertext: string; last_four: string; expires_at: string | null; updated_at: string;
        };
        Insert: { organization_id: string; ciphertext: string; last_four: string; expires_at: string | null; updated_at?: string };
        Update: { ciphertext?: string; last_four?: string; expires_at?: string | null; updated_at?: string };
        Relationships: [];
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
      comparisons: {
        Row: {
          id: string; organization_id: string; analysis_id: string; ref: string;
          base_sha: string; after_sha: string | null;
          status: "queued" | "analyzing" | "complete" | "failed";
          stage: "queued" | "resolving" | "fetching" | "parsing" | "comparing" | "complete" | "failed";
          stage_message: string; stage_started_at: string; finished_at: string | null;
          error_message: string | null; after_adapter: string | null;
          after_coverage: unknown; diff: unknown; created_at: string;
        };
        Insert: never; Update: never; Relationships: [];
      };
      agent_grants: {
        Row: {
          id: string; token_hash: string; analysis_id: string; organization_id: string;
          expires_at: string; created_at: string;
        };
        Insert: { token_hash: string; analysis_id: string; organization_id: string; expires_at: string };
        Update: never; Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      agent_grant_model_key: {
        Args: Record<string, never>;
        Returns: { organization_id: string; provider: string | null; ciphertext: string | null }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
