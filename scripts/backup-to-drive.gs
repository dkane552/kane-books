/**
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
  Logger.log("Backup token (paste into Supabase secret BACKUP_TOKEN):\n" + token);
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
      const driveName = f.path.replace(/\//g, " ~ ");
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
