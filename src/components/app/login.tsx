import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { SignedOutLogo } from "./brand";

// No sign-up here: the one login is created by invitation from the Supabase dashboard (Authentication,
// Users, Invite), and sign-ups are turned off in Supabase.
type Mode = "signin" | "reset";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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
      </div>
    </div>
  );
}
