import { useEffect, useState } from "react";
import {
  Bot,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Factor } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { Panel, LoadingRows } from "./shared";
import { useAuth } from "./auth";

const digits = (s: string) => s.replace(/\D/g, "").slice(0, 6);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** supabase-js hands back the QR as an unencoded SVG data link, which browsers refuse once the SVG
 * has a "#" in it. Encode it so the image always shows. */
export function qrSrc(qr: string) {
  const svg = qr.replace(/^data:image\/svg\+xml(;[^,]*)?,/, "");
  if (!svg.trimStart().startsWith("<")) return qr;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CodeInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <Input
      aria-label="6-digit code"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      placeholder="123456"
      className="number text-center text-lg tracking-[0.4em]"
      value={value}
      onChange={(e) => onChange(digits(e.target.value))}
    />
  );
}

/** Shown after the password when the login has an authenticator app set up. */
export function CodePrompt() {
  const { email, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const factor = data.totp[0];
      if (!factor) throw new Error("No authenticator app is set up for this login.");
      const res = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (res.error) throw res.error;
    } catch (err) {
      setCode("");
      toast.error("That code did not work", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[var(--screen-h)] items-center justify-center bg-background px-4">
      <form onSubmit={verify} className="panel flex w-full max-w-sm flex-col gap-4 p-8">
        <div className="text-center">
          <div className="wordmark">KANE BOOKS</div>
          <div className="eyebrow">PROJECTS</div>
        </div>
        <div>
          <h1 className="text-lg font-semibold">Enter your code</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Open your authenticator app and type the 6-digit code for Kane Books
            {email ? ` (${email})` : ""}.
          </p>
        </div>
        <CodeInput value={code} onChange={setCode} autoFocus />
        <Button type="submit" disabled={busy || code.length !== 6}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Verify
        </Button>
        <button
          type="button"
          className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground hover:underline"
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

type Enrolling = { id: string; qr: string; secret: string };

/** Settings > Security: turn two-step login on or off for your own login. */
export function SecurityPanel() {
  const { email } = useAuth();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast.error("Could not read your login settings", { description: error.message });
      setFactors([]);
      return;
    }
    setFactors(data.totp);
  }
  useEffect(() => {
    load();
  }, []);

  async function start() {
    setBusy(true);
    try {
      // Clear any half-finished setup so its name does not block a new one.
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.all ?? [])
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const taken = new Set((data?.totp ?? []).map((f) => f.friendly_name));
      let n = (data?.totp.length ?? 0) + 1;
      while (taken.has(`Phone ${n}`)) n++;
      const { data: en, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Phone ${n}`,
        issuer: "Kane Books",
      });
      if (error) throw error;
      setEnrolling({ id: en.id, qr: qrSrc(en.totp.qr_code), secret: en.totp.secret });
      setCode("");
    } catch (err) {
      toast.error("Could not start setup", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling || code.length !== 6) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrolling.id,
        code,
      });
      if (error) throw error;
      setEnrolling(null);
      toast.success("Two-step login is on", {
        description: "Next time you sign in, the app will ask for a code after your password.",
      });
      await load();
    } catch (err) {
      setCode("");
      toast.error("That code did not work", {
        description: `${errText(err)} Check the time on your phone is set automatically, then try the next code.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.id });
    setEnrolling(null);
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      await supabase.auth.refreshSession();
      toast.success("Device removed");
      setConfirmRemove(null);
      await load();
    } catch (err) {
      toast.error("Could not remove it", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) toast.error("Could not sign out everywhere", { description: error.message });
  }

  const on = (factors?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Two-step login"
        action={
          factors && (
            <span
              className={`rounded px-2 py-0.5 text-[length:calc(10px*var(--ts,1))] font-semibold ${on ? "bg-accent text-primary" : "bg-muted text-muted-foreground"}`}
            >
              {on ? "ON" : "OFF"}
            </span>
          )
        }
      >
        <div className="space-y-4 px-5 py-4 text-xs leading-loose">
          <p className="text-muted-foreground">
            After your password, the app asks for a 6-digit code from an authenticator app on your
            phone (Google Authenticator, Microsoft Authenticator or 1Password). Someone who learns
            your password still cannot open the books. Each person turns this on for their own login
            {email ? `; this is ${email}` : ""}.
          </p>

          {!factors ? (
            <LoadingRows rows={1} />
          ) : (
            factors.length > 0 && (
              <ul className="divide-y rounded border">
                {factors.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                    <Smartphone className="size-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="font-medium">{f.friendly_name || "Authenticator app"}</div>
                      <div className="text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                        Added {new Date(f.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    {confirmRemove === f.id ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                          Keep
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => remove(f.id)}
                        >
                          Remove
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${f.friendly_name}`}
                        onClick={() => setConfirmRemove(f.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}

          {enrolling ? (
            <form onSubmit={finish} className="space-y-3 rounded border p-4">
              <ol className="list-decimal space-y-1 pl-4">
                <li>In your authenticator app, add an account and scan this code.</li>
                <li>Type the 6-digit code the app shows for Kane Books.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={enrolling.qr}
                  alt="QR code to add Kane Books to your authenticator app"
                  className="size-44 rounded border bg-white p-2"
                />
                <div className="min-w-[14rem] flex-1 space-y-2">
                  <div className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                    Can't scan? Enter this key instead:
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="number break-all rounded bg-muted px-2 py-1 text-[length:calc(11px*var(--ts,1))]">
                      {enrolling.secret}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Copy key"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(enrolling.secret)
                          .then(() => toast.success("Key copied"))
                          .catch(() => toast.error("Could not copy"))
                      }
                    >
                      <Copy />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="max-w-[200px]">
                <CodeInput value={code} onChange={setCode} autoFocus />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  Turn on
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            factors && (
              <Button
                size="sm"
                variant={on ? "outline" : "default"}
                disabled={busy}
                onClick={start}
              >
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {on ? "Add a backup device" : "Set up authenticator app"}
              </Button>
            )
          )}

          <p className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            Lost your phone? Open Supabase, go to Authentication, then Users, pick your login and
            remove its authenticator, then sign in and set it up again. A backup device (a second
            phone or 1Password) avoids that.
          </p>
        </div>
      </Panel>

      <Panel title="Sessions">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs">
          <p className="text-muted-foreground">
            Lost a laptop or phone that was signed in? Sign out of every device, including this one.
          </p>
          <Button size="sm" variant="outline" onClick={signOutEverywhere}>
            <LogOut />
            Sign out everywhere
          </Button>
        </div>
      </Panel>
    </div>
  );
}
