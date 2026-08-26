/**
 * Generated Supabase database types.
 *
 * Placeholder until the schema exists (Phase 3 onward). Regenerate with:
 *
 *   npx supabase gen types typescript --project-id <ref> > types/supabase.ts
 *
 * Once real types land here, every `createClient()` call in lib/supabase picks
 * them up automatically — the clients are already generic over `Database`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
