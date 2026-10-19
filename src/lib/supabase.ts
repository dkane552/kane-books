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

// An invite or password reset link signs you in without a password. Note which kind of link it was (read
// before the client below takes the tokens out of the address) so the app asks for a new password first.
const LINK_KEY = "kane-books.setPassword";
export type PasswordLink = "invite" | "recovery";
function readPasswordLink(): PasswordLink | null {
  if (!isBrowser) return null;
  try {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("type");
    if (t === "invite" || t === "recovery") {
      sessionStorage.setItem(LINK_KEY, t);
      return t;
    }
    const kept = sessionStorage.getItem(LINK_KEY);
    return kept === "invite" || kept === "recovery" ? kept : null;
  } catch {
    return null;
  }
}
export const passwordLink: PasswordLink | null = readPasswordLink();
export function clearPasswordLink() {
  try {
    sessionStorage.removeItem(LINK_KEY);
  } catch {
    // storage blocked: nothing kept
  }
}

/** The error a sign-in link came back with (expired or already used), if any. */
export const linkError: string | null = (() => {
  if (!isBrowser) return null;
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    return p.get("error_description")?.replace(/\+/g, " ") ?? null;
  } catch {
    return null;
  }
})();

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
