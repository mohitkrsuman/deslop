export type Database = {
  public: {
    Tables: {
      analyses: {
        Row: {
          id: string;
          name: string;
          status: "queued" | "analyzing" | "complete" | "failed";
          created_at: string;
          organization_id: string;
          project_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
