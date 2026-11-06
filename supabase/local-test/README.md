# Local SQL test harness (not part of the app)

Runs `schema.sql`, the 2026-11-05 patch and both verify scripts on a throwaway
in-memory Postgres (PGlite, WASM, with pgcrypto). Nothing here can reach a real
database. `stubs.sql` stands in for what Supabase provides (roles,
`auth.uid()`, `auth.role()`, the default EXECUTE grants on new functions). It is
not a Supabase replica: PostgREST is not exercised.

```sh
T=$(mktemp -d)
git show 238cdc7:supabase/schema.sql > "$T/schema-v1.sql"
git show 238cdc7:supabase/verify-rls.sql > "$T/verify-v1.sql"
node supabase/local-test/run.mjs "$PWD" "$T/schema-v1.sql" "$T/verify-v1.sql"
```

PGlite is loaded from another local project (`PGLITE_FROM=/path/to/package.json`,
default `~/dropstack-outreachv2`); it is not a dependency of this app.

- A: fresh `schema.sql`, both verify scripts, schema + patch re-pasted, both again.
- B: the v1 schema as it is live today (238cdc7), with existing rows, then the
  patch twice, both verify scripts, and checks that existing rows are untouched.
