import{C as e,E as t,b as n,p as r,r as i,t as a,x as o}from"./input-DHVbv9wz.js";import{A as s,C as c,D as l,E as u,F as d,H as f,I as p,N as m,O as h,U as g,Y as _,a as v,b as y,mt as b,n as x,ot as S,pt as C,q as w,tt as T,ut as E,x as D}from"./peek-CXBhoUg1.js";import{t as O}from"./useSearch-Bzwmkcox.js";import{i as k,o as A}from"./auth-BlRHDSI2.js";import{t as j}from"./display-settings-C6IGmb9H.js";import{t as M}from"./checkbox-DC57Fn6f.js";import{t as N}from"./trash-2-CJNZJS0S.js";import{t as P}from"./pickers-N40nTtjG.js";var F=n(`database-backup`,[[`ellipse`,{cx:`12`,cy:`5`,rx:`9`,ry:`3`,key:`msslwz`}],[`path`,{d:`M3 12a9 3 0 0 0 5 2.69`,key:`1ui2ym`}],[`path`,{d:`M21 9.3V5`,key:`6k6cib`}],[`path`,{d:`M3 5v14a9 3 0 0 0 6.47 2.88`,key:`i62tjy`}],[`path`,{d:`M12 12v4h4`,key:`1bxaet`}],[`path`,{d:`M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16`,key:`1f4ei9`}]]),I=n(`external-link`,[[`path`,{d:`M15 3h6v6`,key:`1q9fwt`}],[`path`,{d:`M10 14 21 3`,key:`gplh6r`}],[`path`,{d:`M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6`,key:`a6xqqp`}]]),L=t(e(),1),R=`/**
 * Kane Books: nightly backup to Google Drive.
 *
 * Runs in your own Google account (script.google.com), free. Every night it asks the app's
 * backup function for a full copy of the data, saves it to Drive, keeps 30 days of copies, and
 * copies any new photos and files. If a backup fails, it emails you.
 *
 * Setup (one time):
 *   1. script.google.com > New project. Paste this whole file over the sample code. Save.
 *   2. Choose "setup" in the function menu and click Run. Approve the permissions it asks for.
 *   3. Open View > Logs (or Execution log). Copy the backup token it printed.
 *   4. In Supabase > Edge Functions > Secrets, add BACKUP_TOKEN with that token. Save.
 *   5. Choose "runBackup" and click Run once to test. A "Kane Books Backups" folder appears in Drive.
 */

const BACKUP_URL = "https://moszaslmoudygmxygzcf.supabase.co/functions/v1/backup";
const FOLDER_NAME = "Kane Books Backups";
const KEEP_DAYS = 30;
const MAX_FILES_PER_RUN = 150; // stays well inside Apps Script's 6 minute limit

function setup() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty("BACKUP_TOKEN");
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    props.setProperty("BACKUP_TOKEN", token);
  }
  // One trigger, every night around 2 AM.
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "runBackup")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runBackup").timeBased().everyDays(1).atHour(2).create();
  folders_();
  Logger.log("Backup token (paste into Supabase secret BACKUP_TOKEN):\\n" + token);
}

function runBackup() {
  try {
    const token = PropertiesService.getScriptProperties().getProperty("BACKUP_TOKEN");
    if (!token) throw new Error("Run setup first.");
    const res = UrlFetchApp.fetch(BACKUP_URL, {
      method: "post",
      headers: { "x-backup-token": token },
      muteHttpExceptions: true,
    });
    const text = res.getContentText();
    if (res.getResponseCode() !== 200) throw new Error("Backup function said " + res.getResponseCode() + ": " + text.slice(0, 300));
    const data = JSON.parse(text);
    const { data: dataFolder, files: filesFolder } = folders_();

    // 1. The data, one dated file per night.
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const name = "kane-books-backup-" + stamp + ".json";
    const old = dataFolder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    dataFolder.createFile(name, text, "application/json");

    // 2. Keep the last KEEP_DAYS copies.
    const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    const all = dataFolder.getFiles();
    while (all.hasNext()) {
      const f = all.next();
      if (f.getName().indexOf("kane-books-backup-") === 0 && f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
    }

    // 3. Copy photos and documents that are not in Drive yet.
    const have = {};
    const existing = filesFolder.getFiles();
    while (existing.hasNext()) have[existing.next().getName()] = true;
    let copied = 0;
    for (const f of data.files || []) {
      if (copied >= MAX_FILES_PER_RUN) break;
      const driveName = f.path.replace(/\\//g, " ~ ");
      if (have[driveName] || !f.url) continue;
      const blob = UrlFetchApp.fetch(f.url).getBlob().setName(driveName);
      filesFolder.createFile(blob);
      copied++;
    }
    Logger.log("Saved " + name + ": " + data.table_count + " tables, " + data.row_count + " rows, " + copied + " new files.");
  } catch (e) {
    const me = Session.getEffectiveUser().getEmail();
    if (me) MailApp.sendEmail(me, "Kane Books backup failed", String(e && e.stack ? e.stack : e));
    throw e;
  }
}

function folders_() {
  const root = findOrMake_(DriveApp.getRootFolder(), FOLDER_NAME);
  return { root: root, data: findOrMake_(root, "Data"), files: findOrMake_(root, "Files") };
}

function findOrMake_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
`,z=o();function B(){let{data:e,isLoading:t}=p(),n=e?.[0],a=!n||Date.now()-new Date(n.at).getTime()>1296e5;function o(){navigator.clipboard.writeText(R).then(()=>i.success(`Backup script copied`,{description:`Paste it into a new Apps Script project.`})).catch(()=>i.error(`Could not copy the script`))}return(0,z.jsxs)(`div`,{className:`flex flex-col gap-6`,children:[(0,z.jsx)(l,{title:`Nightly backup to Google Drive`,children:t?(0,z.jsx)(c,{rows:2}):n?(0,z.jsxs)(`div`,{className:`px-5 py-4 text-xs`,children:[(0,z.jsxs)(`div`,{className:a?`text-destructive`:``,children:[(0,z.jsxs)(`strong`,{children:[`Last backup `,b(n.at)]}),(0,z.jsxs)(`span`,{className:`text-muted-foreground`,children:[` · `,n.tables,` tables, `,Number(n.rows).toLocaleString(),` rows, `,n.files,` files`]})]}),a&&(0,z.jsx)(`p`,{className:`mt-1 text-destructive`,children:`No backup in the last day and a half. Open the Apps Script project and check its executions, or run runBackup by hand.`})]}):(0,z.jsx)(y,{compact:!0,icon:F,title:`No backups yet`,description:`Set up the free nightly copy to your Google Drive with the steps below.`})}),(0,z.jsxs)(l,{title:`Setup (one time, about 5 minutes)`,action:(0,z.jsxs)(r,{size:`sm`,variant:`outline`,onClick:o,children:[(0,z.jsx)(A,{}),`Copy backup script`]}),children:[(0,z.jsxs)(`ol`,{className:`list-decimal space-y-2 py-4 pl-10 pr-5 text-xs leading-relaxed`,children:[(0,z.jsxs)(`li`,{children:[`Click `,(0,z.jsx)(`strong`,{children:`Copy backup script`}),`, then open`,` `,(0,z.jsxs)(`a`,{className:`inline-flex items-center gap-1 text-primary hover:underline`,href:`https://script.google.com/home/projects/create`,target:`_blank`,rel:`noreferrer`,children:[`a new Apps Script project `,(0,z.jsx)(I,{className:`size-3`})]}),` `,`while signed in to the Google account that should hold the backups. Replace the sample code with the script and save.`]}),(0,z.jsxs)(`li`,{children:[`Pick `,(0,z.jsx)(`strong`,{children:`setup`}),` in the function menu and click `,(0,z.jsx)(`strong`,{children:`Run`}),`. Approve the permissions (Drive, sending you an email if a backup fails, and calling the app).`]}),(0,z.jsxs)(`li`,{children:[`Copy the backup token from the execution log. In Supabase, go to Edge Functions, Secrets, add `,(0,z.jsx)(`code`,{children:`BACKUP_TOKEN`}),` with that token, and save.`]}),(0,z.jsxs)(`li`,{children:[`Pick `,(0,z.jsx)(`strong`,{children:`runBackup`}),` and click Run. A `,(0,z.jsx)(`em`,{children:`Kane Books Backups`}),` folder appears in Drive with the data and a copy of every photo and file.`]})]}),(0,z.jsx)(`p`,{className:`border-t px-5 py-3 text-[length:calc(11px*var(--ts,1))] text-muted-foreground`,children:`After that it runs every night around 2 AM, keeps 30 days of data copies, and emails you if a backup fails. QuickBooks sign-in tokens are never included.`})]})]})}var V=[`Books`,`Payees`,`Security`,`Accessibility`,`Backups`];function H(){let{tab:e}=O({from:`/settings`}),[t,n]=(0,L.useState)(()=>V.includes(e??``)?e:`Books`);return(0,L.useEffect)(()=>{V.includes(e??``)&&n(e)},[e]),(0,z.jsxs)(z.Fragment,{children:[(0,z.jsx)(u,{title:`Settings`,eyebrow:`KANE BOOKS`,subtitle:`How the books are set up, who you pay, and keeping it all safe.`}),(0,z.jsxs)(`div`,{className:`settings-layout`,children:[(0,z.jsx)(`nav`,{className:`settings-menu`,"aria-label":`Settings sections`,children:V.map(e=>(0,z.jsx)(r,{variant:`ghost`,className:`tab-link`,"data-active":t===e,onClick:()=>n(e),children:e},e))}),(0,z.jsxs)(`div`,{children:[t===`Books`&&(0,z.jsx)(W,{}),t===`Payees`&&(0,z.jsx)(G,{}),t===`Security`&&(0,z.jsx)(k,{}),t===`Accessibility`&&(0,z.jsx)(j,{}),t===`Backups`&&(0,z.jsx)(B,{})]})]})]})}var U=[{key:`default_cash_gl_id`,label:`Main checking account`,types:[`Bank`],hint:`New expenses and deposits start from this account.`},{key:`opening_equity_gl_id`,label:`Opening balances go to`,types:[`Equity`]},{key:`net_worth_carried_gl_id`,label:`Past years' savings go to`,types:[`Equity`],hint:`Where each year's net closes on the net worth statement.`},{key:`value_change_gl_id`,label:`Value changes go to`,types:[`Other Income`,`Income`],hint:`Gains and losses from value updates on investments, property and vehicles.`},{key:`uncategorized_expense_gl_id`,label:`Uncategorized spending`,types:[`Expense`]},{key:`uncategorized_income_gl_id`,label:`Uncategorized income`,types:[`Income`]}];function W(){let{data:e}=T(),{data:t}=g(),{data:n}=w(),{data:o}=d(60),c=f(),{show:u}=v(),[p,_]=(0,L.useState)({}),[y,b]=(0,L.useState)(``);return(0,L.useEffect)(()=>{if(!e)return;let t=e,n={owner_name:String(t.owner_name??``),ledger_start_date:String(t.ledger_start_date??``),bank_feed_start_date:String(t.bank_feed_start_date??``),fiscal_year_start_month:String(t.fiscal_year_start_month??1),auto_add_limit:String(t.auto_add_limit??1e3)};for(let e of U)n[e.key]=String(t[e.key]??``);_(n),b(e.books_closed_through??``)},[e]),(0,z.jsxs)(`div`,{className:`stack`,children:[(0,z.jsxs)(l,{title:`The books`,children:[(0,z.jsxs)(`div`,{className:`form-grid`,children:[(0,z.jsx)(D,{label:`Your name`,hint:`On reports and the tax pack.`,children:(0,z.jsx)(a,{value:p.owner_name??``,onChange:e=>_({...p,owner_name:e.target.value})})}),(0,z.jsx)(D,{label:`Books start on`,hint:`Nothing dated earlier counts. Enter opening balances dated this day.`,children:(0,z.jsx)(a,{type:`date`,value:p.ledger_start_date??``,onChange:e=>_({...p,ledger_start_date:e.target.value})})}),(0,z.jsx)(D,{label:`Bank feed reads from`,hint:`The first sync of a newly linked account goes back to this day.`,children:(0,z.jsx)(a,{type:`date`,value:p.bank_feed_start_date??``,onChange:e=>_({...p,bank_feed_start_date:e.target.value})})}),(0,z.jsx)(D,{label:`Add automatically up to`,hint:`Bank transactions bigger than this wait for you instead of being added from Era's category. Your rules are not limited.`,children:(0,z.jsx)(a,{type:`number`,min:`0`,step:`50`,value:p.auto_add_limit??`1000`,onChange:e=>_({...p,auto_add_limit:e.target.value})})}),(0,z.jsx)(D,{label:`Year starts in`,children:(0,z.jsx)(h,{value:p.fiscal_year_start_month??`1`,onChange:e=>_({...p,fiscal_year_start_month:e}),children:[`January`,`February`,`March`,`April`,`May`,`June`,`July`,`August`,`September`,`October`,`November`,`December`].map((e,t)=>(0,z.jsx)(`option`,{value:t+1,children:e},e))})}),U.map(e=>(0,z.jsx)(D,{label:e.label,...e.hint?{hint:e.hint}:{},children:(0,z.jsxs)(h,{value:p[e.key]??``,onChange:t=>_({...p,[e.key]:t}),children:[(0,z.jsx)(`option`,{value:``,children:`None`}),(0,z.jsx)(P,{accounts:t,types:e.types,keep:p[e.key]})]})},e.key))]}),(0,z.jsx)(`div`,{className:`flex justify-end gap-2 px-5 pb-4`,children:(0,z.jsx)(r,{disabled:c.pending,onClick:async()=>{let t={owner_name:p.owner_name||`Me`,ledger_start_date:p.ledger_start_date||null,bank_feed_start_date:p.bank_feed_start_date||null,fiscal_year_start_month:Number(p.fiscal_year_start_month||1),auto_add_limit:Math.max(0,Number(p.auto_add_limit||0))};for(let e of U)t[e.key]=p[e.key]||null;await c.update(`book_settings`,`1`,t),String(e?.auto_add_limit??``)!==String(t.auto_add_limit)&&await c.batch(()=>m(`bank_autoprocess`,{})),i.success(`Settings saved`)},children:`Save`})})]}),(0,z.jsx)(l,{title:`Close the books`,children:(0,z.jsxs)(`div`,{className:`flex flex-wrap items-end gap-3 p-5`,children:[(0,z.jsx)(D,{label:`Closed through`,children:(0,z.jsx)(a,{type:`date`,value:y,onChange:e=>b(e.target.value)})}),(0,z.jsx)(r,{disabled:!y||c.pending,onClick:async()=>{s(`Lock every transaction dated on or before ${S(y)}?`)&&(await c.update(`book_settings`,`1`,{books_closed_through:y}),i.success(`Books closed`))},children:`Close`}),e?.books_closed_through&&(0,z.jsx)(r,{variant:`outline`,disabled:c.pending,onClick:async()=>{s(`Reopen the books? Anything in the closed period can be changed again until you close it.`)&&await c.update(`book_settings`,`1`,{books_closed_through:null})},children:`Reopen`}),(0,z.jsx)(`p`,{className:`basis-full text-[length:calc(11px*var(--ts,1))] text-muted-foreground`,children:`Close a month once its accounts are reconciled, and close the year before sending the tax pack. While closed, nothing dated in the period can be added, changed or deleted.`})]})}),(0,z.jsx)(l,{title:`Entries that do not balance`,meta:n?.length??0,children:n?.length?(0,z.jsx)(`ul`,{className:`divide-y text-xs`,children:n.map(e=>(0,z.jsx)(`li`,{children:(0,z.jsxs)(`button`,{type:`button`,className:`flex w-full gap-3 px-5 py-2 text-left hover:bg-muted/60`,onClick:()=>u({kind:`entry`,id:e.source_id}),children:[(0,z.jsx)(`span`,{className:`w-24`,children:S(e.txn_date)}),(0,z.jsxs)(`span`,{className:`flex-1`,children:[e.problem,` by `,E(e.out_of_balance)]})]})},e.source_id))}):(0,z.jsx)(`p`,{className:`p-5 text-xs text-muted-foreground`,children:`None. Every entry balances.`})}),(0,z.jsx)(l,{title:`Audit log`,meta:`latest 60`,children:(0,z.jsx)(`div`,{className:`data-scroll max-h-[360px]`,children:(0,z.jsxs)(`table`,{className:`data-table`,children:[(0,z.jsx)(`thead`,{children:(0,z.jsxs)(`tr`,{children:[(0,z.jsx)(`th`,{children:`When`}),(0,z.jsx)(`th`,{children:`What`}),(0,z.jsx)(`th`,{children:`Changed`})]})}),(0,z.jsx)(`tbody`,{children:o?.map(e=>{let t=e.op===`UPDATE`&&e.old_row&&e.new_row?Object.keys(e.new_row).filter(t=>t!==`updated_at`&&JSON.stringify(e.new_row[t])!==JSON.stringify(e.old_row[t])):[],n=e.op!==`DELETE`&&e.table_name===`ledger_entries`&&e.row_id;return(0,z.jsxs)(`tr`,{children:[(0,z.jsx)(`td`,{className:`whitespace-nowrap`,children:new Date(e.at).toLocaleString(`en-US`)}),(0,z.jsx)(`td`,{children:n?(0,z.jsxs)(x,{target:{kind:`entry`,id:e.row_id},children:[e.op===`INSERT`?`Added`:`Changed`,` an entry`]}):(0,z.jsxs)(z.Fragment,{children:[e.op===`INSERT`?`Added`:e.op===`UPDATE`?`Changed`:`Deleted`,` `,e.table_name.replace(/_/g,` `)]})}),(0,z.jsx)(`td`,{className:`max-w-[360px] truncate text-[length:calc(11px*var(--ts,1))] text-muted-foreground`,children:t.map(t=>`${t}: ${String(e.old_row[t]??``)} to ${String(e.new_row[t]??``)}`).join(`; `)})]},e.id)})})]})})})]})}function G(){let{data:e,isLoading:t}=_(),n=f(),[i,o]=(0,L.useState)(``),[u,d]=(0,L.useState)(``),p=(e??[]).filter(e=>e.name.toLowerCase().includes(u.toLowerCase()));return(0,z.jsxs)(l,{title:`Payees`,meta:e?.length??0,children:[(0,z.jsxs)(`div`,{className:`toolbar`,children:[(0,z.jsx)(a,{className:`h-8 w-48`,placeholder:`Search`,value:u,onChange:e=>d(e.target.value),"aria-label":`Search payees`}),(0,z.jsxs)(`div`,{className:`toolbar-end ml-auto flex gap-2`,children:[(0,z.jsx)(a,{className:`h-8 w-48`,placeholder:`New payee`,value:i,onChange:e=>o(e.target.value),"aria-label":`New payee name`}),(0,z.jsx)(r,{size:`sm`,disabled:!i.trim()||n.pending,onClick:async()=>{await n.insert(`payees`,{name:i.trim()}),o(``)},children:`Add`})]})]}),t?(0,z.jsx)(c,{}):p.length?(0,z.jsx)(`ul`,{className:`divide-y text-xs`,children:p.map(e=>(0,z.jsxs)(`li`,{className:`flex items-center gap-3 px-5 py-1.5`,children:[(0,z.jsx)(`span`,{className:`flex-1`,children:(0,z.jsx)(x,{target:{kind:`payee`,id:e.id},children:e.name})}),(0,z.jsxs)(`label`,{className:`flex items-center gap-1.5 text-muted-foreground`,children:[(0,z.jsx)(M,{checked:e.is_active,onCheckedChange:t=>n.update(`payees`,e.id,{is_active:t===!0})}),`In the list`]}),(0,z.jsx)(r,{size:`sm`,variant:`ghost`,"aria-label":`Delete ${e.name}`,onClick:async()=>{s(`Delete ${e.name}? Entries keep their amounts but lose the payee.`)&&await n.remove(`payees`,e.id)},children:(0,z.jsx)(N,{})})]},e.id))}):(0,z.jsx)(y,{compact:!0,title:`No payees`,description:`Payees are added as you name them on transactions.`}),(0,z.jsxs)(`p`,{className:`px-5 pb-4 text-[length:calc(10px*var(--ts,1))] text-muted-foreground`,children:[C(e?.length),` payees. Untick one to hide it from the pickers without losing its history.`]})]})}var K=()=>(0,z.jsx)(H,{});export{K as component};