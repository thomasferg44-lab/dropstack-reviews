import { createClient } from "@supabase/supabase-js";
import { createMockClient } from "../dev/mockBackend.js";

// VITE_MOCK_BACKEND=1 swaps in the local in-memory test backend (gate runs,
// screenshots, laptop demos). Vite replaces the env check at build time, so a
// normal build drops the mock entirely.
const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isMockBackend = MOCK;
// True when .env has been filled in. The app shows a setup notice otherwise
// instead of crashing with an opaque error.
export const isConfigured = MOCK || Boolean(url && anonKey);

// Owner dashboard client. Uses the anon key; once the owner signs in,
// supabase-js attaches their JWT and Postgres sees them as `authenticated`.
export const supabase = MOCK ? createMockClient() : isConfigured ? createClient(url, anonKey) : null;
