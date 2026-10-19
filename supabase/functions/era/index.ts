// Kane Books: bank feed from Era (era). Source: supabase/functions/era in the repo.
//
// POST { action } from the app, signed in (deploy with JWT verification off; requireTeam checks the session):
//   status    -> { configured, state }
//   accounts  -> Era accounts the key can see (not stored), for linking a new one in Accounting > Bank feed
//   sync      -> pull posted transactions for the linked accounts, refresh balances, match to the books
//
// Secret (Supabase > Edge Functions > Secrets): ERA_API_KEY, an Era API key (fmk_...) with banking:read.
// Only linked accounts (bank_feed_accounts) are ever read; anything else in Era (the Spyglass business
// accounts, say) is never stored. Accounts linked "balance only" (investments) get their balance, not
// their transactions, and auto_value ones get a valuation entry so net worth follows the market.

import postgres from "npm:postgres@3.4.5";

const ERA_API = "https://forge.era.app/api";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://moszaslmoudygmxygzcf.supabase.co";
const PUBLIC_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? "sb_publishable_XCh0o98NCD0J7_fSRrTuzg_EC1Opcii";
const ERA_KEY = (Deno.env.get("ERA_API_KEY") ?? "").trim();
// Look back this far on every sync, so late-posting and edited transactions are picked up.
const OVERLAP_DAYS = 10;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", {
  prepare: false,
  max: 1,
  idle_timeout: 20,
});

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function requireTeam(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first.");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY },
  });
  if (!r.ok) throw new HttpError(401, "Your session expired. Sign in again.");
  const user = await r.json();
  const email = String(user?.email ?? "").toLowerCase();
  // Same rule as every table: is_team() run as this login (team list, confirmed email, and the
  // authenticator code when two-step login is on).
  const t = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_team`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: PUBLIC_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!t.ok || (await t.json()) !== true)
    throw new HttpError(403, "This login is not allowed in Kane Books.");
  return email;
}

async function era(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  if (!ERA_KEY) throw new HttpError(400, "Add the ERA_API_KEY secret in Supabase first.");
  const url = new URL(ERA_API + path);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { "X-API-Key": ERA_KEY, Accept: "application/json" } });
    if (r.status === 429) {
      const wait = Math.min(Number(r.headers.get("Retry-After") ?? "5"), 30);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      continue;
    }
    const text = await r.text();
    if (!r.ok) {
      const hint =
        r.status === 401 || r.status === 403
          ? "Era refused the API key. It may have expired: make a new one at era.app and update ERA_API_KEY."
          : `Era answered ${r.status}.`;
      throw new HttpError(502, `${hint} ${text.slice(0, 200)}`.trim());
    }
    return text ? JSON.parse(text) : {};
  }
  throw new HttpError(429, "Era is busy right now. Try again in a minute.");
}

const day = (d: Date) => d.toISOString().slice(0, 10);

async function listAccounts() {
  const r = await era("/banking/accounts", { IncludeExcluded: true });
  return (r.accounts ?? []).map((a: Row) => ({
    key: a.accountGroupKey,
    name: a.name,
    institution: a.institutionName ?? null,
    mask: a.accountMask ?? null,
    type: a.accountType ?? a.universalAccountType ?? null,
    balance: a.currentBalance ?? null,
    balance_as_of: a.balanceAsOf ?? null,
  }));
}

async function sync(by: string) {
  const [lock] = await sql`
    update public.bank_feed_state set sync_started_at = now()
    where id = 1 and (sync_started_at is null or sync_started_at < now() - interval '5 minutes')
    returning *`;
  if (!lock) return { skipped: true, reason: "A bank sync is already running." };
  try {
    const [settings] =
      await sql`select bank_feed_start_date from public.book_settings where id = 1`;
    const feeds =
      await sql`select * from public.bank_feed_accounts where is_active and gl_account_id is not null`;
    const today = day(new Date());
    let fetched = 0;
    let changed = 0;

    // Balances for the linked accounts only.
    const all = await listAccounts();
    for (const f of feeds) {
      const a = all.find((x: Row) => x.key === f.era_account_key);
      if (a)
        await sql`update public.bank_feed_accounts set balance = ${a.balance}, balance_as_of = ${a.balance_as_of},
                  updated_at = now() where id = ${f.id}`;
    }

    for (const f of feeds.filter((x: Row) => !x.balance_only)) {
      const floor = settings?.bank_feed_start_date ? new Date(settings.bank_feed_start_date) : null;
      let from = f.last_synced_at
        ? new Date(f.last_synced_at)
        : (floor ?? new Date(Date.now() - 30 * 864e5));
      from = new Date(from.getTime() - (f.last_synced_at ? OVERLAP_DAYS * 864e5 : 0));
      if (floor && from < floor) from = floor;
      const rows: Row[] = [];
      for (let page = 1; page < 100; page++) {
        // Parameter names exactly as in Era's OpenAPI document (forge.era.app/api/openapi/public.json).
        const r = await era("/banking/transactions", {
          AccountId: f.era_account_key,
          FromDate: day(from),
          ToDate: today,
          IncludePending: false,
          Page: page,
          PageSize: 100,
          SortBy: "transactionDate",
          SortDirection: "asc",
        });
        for (const t of r.transactions ?? []) {
          if (t.isPending || !t.id || t.accountGroupKey !== f.era_account_key) continue;
          const amount = Math.abs(Number(t.amount)) * (t.isCashOutflow ? -1 : 1);
          if (!amount) continue;
          rows.push({
            era_id: t.id,
            txn_date: t.postedDate ?? t.transactionDate,
            amount: Math.round(amount * 100) / 100,
            description: t.description ?? null,
            original_description: t.originalDescription ?? t.description ?? null,
            merchant: t.merchantName ?? null,
            era_category: t.category ?? null,
            transfer_era_id: t.transferLink?.linkedTransactionId ?? null,
          });
        }
        if (!r.pagination || page >= (r.pagination.totalPages ?? 1)) break;
      }
      fetched += rows.length;
      if (rows.length) {
        const [n] =
          await sql`select public.bank_upsert_transactions(${f.id}, ${sql.json(rows)}) as n`;
        changed += Number(n?.n ?? 0);
      }
      await sql`update public.bank_feed_accounts set last_synced_at = now(), updated_at = now() where id = ${f.id}`;
    }

    const [auto] = await sql`select public.bank_autoprocess() as r`;
    const r = auto?.r ?? {};
    const [vals] = await sql`select public.feed_auto_valuations() as n`;
    const valued = Number(vals?.n ?? 0);
    const status = [
      `${fetched} transactions read`,
      `${changed} new or changed`,
      `${r.matched ?? 0} matched`,
      ...(r.added_by_rules ? [`${r.added_by_rules} added by rules`] : []),
      ...(valued ? [`${valued} ${valued === 1 ? "value" : "values"} updated`] : []),
    ].join(" · ");
    await sql`update public.bank_feed_state set last_sync_at = now(), last_status = ${status}, last_error = null,
              sync_started_at = null, updated_at = now() where id = 1`;
    return { ok: true, status, by };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`update public.bank_feed_state set last_sync_at = now(), last_error = ${msg}, sync_started_at = null,
              updated_at = now() where id = 1`;
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST");
    const email = await requireTeam(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "status": {
        const [state] = await sql`select * from public.bank_feed_state where id = 1`;
        return json({ configured: !!ERA_KEY, state });
      }
      case "accounts":
        return json({ accounts: await listAccounts() });
      case "sync":
        return json(await sync(email));
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
