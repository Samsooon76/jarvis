import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let supabaseAdmin: SupabaseClient | null = null;

export const getSupabaseAdmin = (): SupabaseClient => {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "Configuration Supabase manquante. Renseigne SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdmin;
};
