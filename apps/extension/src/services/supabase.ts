import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ??
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ??
  "";

let supabaseClient: SupabaseClient | null = null;

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const getSupabaseClient = (): SupabaseClient => {
  if (!isSupabaseAuthConfigured) {
    throw new Error("Supabase Auth n'est pas configure cote frontend.");
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
  }

  return supabaseClient;
};

export type JarvisSession = Session;
