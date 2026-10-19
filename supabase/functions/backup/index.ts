// Kane Books: nightly backup source (backup). Source: supabase/functions in the repo.
// Called by the Google Apps Script in scripts/backup-to-drive.gs, which saves the result to Drive.
//
// POST with header "x-backup-token: <BACKUP_TOKEN secret>". Deploy with JWT verification off.
// Returns every table in the public schema (except QuickBooks sign-in tokens) as JSON, plus the
// list of stored files with one-hour download links so the script can copy new ones.

import postgres from "npm:postgres@3.4.5";

const BUCKET = "kane-books-files";
const SKIP_TABLES = new Set<string>();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://moszaslmoudygmxygzcf.supabase.co";
const env = (name: string) => (Deno.env.get(name) ?? "").trim();

const sql = postgres(env("SUPABASE_DB_URL"), { prepare: false, max: 1, idle_timeout: 20 });

function serviceKey(): string {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const first = Object.values(keys)[0];
    return typeof first === "string" ? first : "";
  } catch {
    return "";
  }
}

/** Constant-time comparison so the token can't be guessed by timing. */
function sameToken(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function signedLinks(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = serviceKey();
  if (!key) return out;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: chunk }),
    });
    if (!r.ok) continue;
    for (const s of (await r.json()) as { path: string; signedURL?: string }[]) {
      if (s.signedURL) out.set(s.path, `${SUPABASE_URL}/storage/v1${s.signedURL}`);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const expected = env("BACKUP_TOKEN");
  if (!expected) return json({ error: "BACKUP_TOKEN is not set in Supabase secrets." }, 500);
  if (req.method !== "POST" || !sameToken(req.headers.get("x-backup-token") ?? "", expected))
    return json({ error: "Not allowed" }, 401);

  try {
    const tableNames = (
      await sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
    )
      .map((r) => String(r.table_name))
      .filter((t) => !SKIP_TABLES.has(t));

    const tables: Record<string, unknown[]> = {};
    let rows = 0;
    for (const t of tableNames) {
      // Names come from information_schema, quoted for safety.
      const data = await sql.unsafe(`select * from public."${t.replace(/"/g, '""')}"`);
      tables[t] = [...data];
      rows += data.length;
    }

    const objects = await sql`
      select name, (metadata->>'size')::bigint as size, updated_at
      from storage.objects where bucket_id = ${BUCKET} order by name`;
    const links = await signedLinks(objects.map((o) => String(o.name)));
    const files = objects.map((o) => ({
      path: String(o.name),
      size: Number(o.size ?? 0),
      updated_at: o.updated_at,
      url: links.get(String(o.name)) ?? null,
    }));

    await sql`insert into public.backup_log (tables, rows, files) values (${tableNames.length}, ${rows}, ${files.length})`.catch(
      () => undefined,
    );

    return json({
      app: "Kane Books",
      created_at: new Date().toISOString(),
      table_count: tableNames.length,
      row_count: rows,
      tables,
      files,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
