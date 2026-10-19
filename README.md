# Kane Books

Personal books, QuickBooks style: bank and card feed, categories, budgets, recurring bills, net worth,
side-project profit and loss, reconciliations, reports and a year-end tax pack for the CPA.

Built from the accounting side of Spyglass Projects, on its own free Supabase project and site.
How it works inside: `AGENTS.md`.

## Setting it up (once)

1. **Database.** In Supabase, open the **Kane Books** project, then SQL Editor, paste all of
   `supabase/setup_all.sql` and Run. It ends by showing `anon_readable_tables = 0`.
2. **Your login.** Authentication > Users > Invite user: `derekkane552@gmail.com`. Then Authentication >
   Sign In / Providers: turn off "Allow new users to sign up". Under URL Configuration set the Site URL to the
   app's address (step 4) so the invite and password links land there.
3. **Bank feed (Era).** Edge Functions > Deploy a new function named `era` with the code in
   `supabase/functions/era/index.ts`, and turn off "Verify JWT" for it (it checks your login itself). Then
   Edge Functions > Secrets: add `ERA_API_KEY` (the same Era key Spyglass uses works; only the accounts you
   link here are read).
4. **Website.** Cloudflare Pages > Create > Connect to Git > `dkane552/kane-books`, production branch
   `deploy`, no build command, output folder `/`. Run `scripts/deploy.sh` to publish.
5. **In the app.** Settings > Books: set "Books start on" (for example the first of this year) and "Bank feed
   reads from". Transactions > Accounts and rules > Link an Era account for each personal account (leave the
   Spyglass ones). Add opening balances (Accounts > Add an account, or Transactions > Entries > New entry >
   Opening balance). Turn on two-step login in Settings > Security.

Optional: nightly backups to Google Drive (Settings > Backups explains the steps).

## Working on it

```
npm install
npm run dev        # local app against the real project
npm test           # unit tests
scripts/deploy.sh  # build and publish
```

Database tests run on a scratch Postgres (see `AGENTS.md`).
