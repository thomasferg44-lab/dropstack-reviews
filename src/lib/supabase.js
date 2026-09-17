import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True when .env has been filled in. App shows a setup notice otherwise
// instead of crashing with an opaque error.
export const isConfigured = Boolean(url && anonKey);

// Owner dashboard client. Uses the anon key; once the owner signs in,
// supabase-js attaches their JWT and Postgres sees them as `authenticated`.
export const supabase = isConfigured ? createClient(url, anonKey) : null;
