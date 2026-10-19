import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Kane Books' own Supabase project (not Spyglass's). The publishable key is meant to ship in the browser;
// row-level security (only emails in app_users) is what protects the data.
// Environment variables override these, e.g. for a test project.
const DEFAULT_URL = "https://moszaslmoudygmxygzcf.supabase.co";
const DEFAULT_KEY = "sb_publishable_XCh0o98NCD0J7_fSRrTuzg_EC1Opcii";

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  DEFAULT_KEY;

export const isSupabaseConfigured = Boolean(url && key);

const isBrowser = typeof window !== "undefined";

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
    storage: isBrowser ? window.localStorage : undefined,
    storageKey: "kane-books-auth",
  },
});

/** Throw a readable error from a Supabase response. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
