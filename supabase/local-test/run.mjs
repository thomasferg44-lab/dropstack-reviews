// Local SQL harness: schema.sql, the 2026-11-05 patch and both verify scripts
// on a throwaway in-memory Postgres (PGlite/WASM). Nothing here can reach a
// real database. PGlite is borrowed from another local project; it is not a
// dependency of this app.
//   node supabase/local-test/run.mjs <repo> <schema-v1.sql> <verify-rls-v1.sql>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(process.env.PGLITE_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
const { PGlite } = await import(require.resolve("@electric-sql/pglite"));
const { pgcrypto } = await import(require.resolve("@electric-sql/pglite/contrib/pgcrypto"));
const [REPO, V1_SCHEMA, V1_VERIFY] = process.argv.slice(2);
const here = new URL(".", import.meta.url).pathname;
const read = (p) => readFileSync(p, "utf8");
let failures = 0;
const summary = [];

async function fresh() { const db = new PGlite({ extensions: { pgcrypto } }); await db.exec(read(here + "stubs.sql")); return db; }
async function verify(db, file, label) {
  const out = await db.exec(read(file));
  const rows = out.at(-1).rows;
  const bad = rows.filter((r) => r.status !== "PASS");
  failures += bad.length;
  summary.push(`${label}: ${rows.length - bad.length}/${rows.length} PASS`);
  console.log(`\n== ${label}: ${rows.length - bad.length}/${rows.length} PASS`);
  for (const r of rows) console.log(`  ${r.status === "PASS" ? "ok  " : "FAIL"} ${r.n}. ${r.check} -> ${r.detail}`);
}
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label} ${detail}`); if (!ok) failures++; summary.push(`${ok ? "ok" : "FAIL"}: ${label}`); };
const count = async (db, sql) => Number((await db.query(sql)).rows[0].n);

// A. Fresh project from the folded schema.sql, then re-pasted (idempotent)
{
  const db = await fresh();
  await db.exec(read(REPO + "/supabase/schema.sql"));
  await verify(db, REPO + "/supabase/verify-rls.sql", "A. fresh schema.sql / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A. fresh schema.sql / verify-compete-upgrades.sql");
  await db.exec(read(REPO + "/supabase/schema.sql"));
  await db.exec(read(REPO + "/supabase/patches/2026-11-05-compete-upgrades.sql"));
  await verify(db, REPO + "/supabase/verify-rls.sql", "A2. schema.sql + patch re-pasted / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A2. schema.sql + patch re-pasted / verify-compete-upgrades.sql");
  const left = await count(db, "select (select count(*) from reviews_customers) + (select count(*) from reviews_showcase) as n");
  check("verify scripts leave no rows behind", left === 0, `(${left} rows)`);
}

// B. Upgrade path: the v1 schema as live today, with existing rows, then the patch twice
{
  const db = await fresh();
  await db.exec(read(V1_SCHEMA));
  await verify(db, V1_VERIFY, "B0. v1 schema (as live today) / v1 verify-rls.sql");
  const c = (await db.query(`insert into reviews_customers (name, phone, email) values ('Legacy Customer', '+27000000003', 'test@example.com') returning id`)).rows[0].id;
  const j = (await db.query(`insert into reviews_jobs (customer_id, description, completed_at) values ($1, 'legacy job', now() - interval '10 days') returning id`, [c])).rows[0].id;
  await db.query(`insert into reviews_requests (customer_id, job_id, channel, sent_at, clicked_at) values ($1, $2, 'whatsapp', now() - interval '9 days', now() - interval '8 days'), ($1, $2, 'email', now() - interval '20 days', null)`, [c, j]);
  const snap = async () => JSON.stringify((await db.query(`select customer_id, job_id, channel, token, sent_at, clicked_at from reviews_requests order by sent_at`)).rows);
  const before = await snap();

  const patch = read(REPO + "/supabase/patches/2026-11-05-compete-upgrades.sql");
  await db.exec(patch);
  await db.exec(patch); // idempotent
  await verify(db, REPO + "/supabase/verify-rls.sql", "B1. v1 + patch x2 / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "B1. v1 + patch x2 / verify-compete-upgrades.sql");
  check("existing requests untouched by the patch", (await snap()) === before);
  const flags = (await db.query(`select bool_or(is_demo) as d, count(*) filter (where followed_up_at is null and feedback_at is null and google_clicked_at is null) as n from reviews_requests`)).rows[0];
  check("existing rows default to real (not demo), no response/follow-up invented", flags.d === false && Number(flags.n) === 2);
  check("legacy customer still present", (await count(db, "select count(*) as n from reviews_customers where name = 'Legacy Customer'")) === 1);
}

console.log("\n" + summary.join("\n"));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
