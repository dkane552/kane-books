import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, linkError, type PasswordLink } from "@/lib/supabase";
import { SignedOutLogo } from "./brand";

function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="login-layout">
      <div className="login-photo">
        <div className="login-ledger" aria-hidden />
        <div className="house-caption">
          <strong>Every dollar, accounted for.</strong>
          <span>KANE BOOKS</span>
        </div>
      </div>
      <div className="login-form">
        <SignedOutLogo />
        <div className="eyebrow">PERSONAL BOOKS</div>
        {children}
      </div>
    </div>
  );
}

/** After an invite or password reset link: choose the password for next time. */
export function SetPasswordPage({
  kind,
  email,
  onDone,
  onCancel,
}: {
  kind: PasswordLink;
  email: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password saved", { description: "Use it with your email to sign in." });
      onDone();
    } catch (err) {
      toast.error("Could not save the password", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoginShell>
      <form onSubmit={submit}>
        <div>
          <h1>{kind === "invite" ? "Welcome to your books." : "Choose a new password."}</h1>
          <p className="text-xs text-muted-foreground">
            {kind === "invite"
              ? `Set a password for ${email ?? "your login"}. You will use it to sign in from now on.`
              : `Set a new password for ${email ?? "your login"}.`}
          </p>
        </div>
        <label className="field">
          New password
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          Type it again
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            aria-invalid={mismatch}
          />
          {mismatch && <span className="text-xs text-destructive">The two do not match.</span>}
        </label>
        <Button type="submit" disabled={busy || mismatch || password.length < 8}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Save password
          <ArrowRight />
        </Button>
        <button
          type="button"
          className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground hover:underline"
          onClick={onCancel}
        >
          Not now, sign out
        </button>
      </form>
    </LoginShell>
  );
}

// No sign-up here: the one login is created by invitation from the Supabase dashboard (Authentication,
// Users, Invite), and sign-ups are turned off in Supabase.
type Mode = "signin" | "reset";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // A link from an email that expired or was already used comes back here with the reason.
  useEffect(() => {
    if (linkError) {
      toast.error("That link did not work", {
        id: "link-error",
        description: `${linkError}. Use Forgot password to get a new one.`,
      });
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw error;
        toast.success("Reset link sent", {
          description: `Check ${email} for a link to set a new password.`,
        });
        setMode("signin");
      }
    } catch (err) {
      toast.error(mode === "signin" ? "Could not sign in" : "Something went wrong", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoginShell>
      <form onSubmit={submit}>
        <div>
          <h1>{mode === "signin" ? "Welcome back." : "Reset your password."}</h1>
          <p className="text-xs text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your books."
              : "We will email you a link to set a new password."}
          </p>
        </div>
        <label className="field">
          Email
          <Input
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== "reset" && (
          <label className="field">
            Password
            <Input
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {mode === "signin" ? "Sign in" : "Send reset link"}
          <ArrowRight />
        </Button>
        <div className="flex justify-between text-[length:calc(11px*var(--ts,1))]">
          {mode === "signin" ? (
            <>
              <span className="text-muted-foreground">Private books</span>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setMode("reset")}
              >
                Forgot password
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setMode("signin")}
            >
              Back to sign in
            </button>
          )}
        </div>
        <p className="flex items-center justify-center gap-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
          <LockKeyhole className="size-3" />
          Private books · Derek Kane
        </p>
      </form>
    </LoginShell>
  );
}
