import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { Compass, Loader2, LogOut, ShieldAlert, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AppUser } from "@/lib/types";
import { useLiveRefresh } from "@/lib/data";
import { CodePrompt } from "./security";
import { SignedOutLogo } from "./brand";

interface AuthState {
  ready: boolean;
  session: Session | null;
  email: string | null;
  member: AppUser | null;
  memberChecked: boolean;
  /** False until we know whether this login still owes its authenticator code. */
  mfaChecked: boolean;
  /** The login has an authenticator app set up and this session has not entered its code yet. */
  needsCode: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  ready: false,
  session: null,
  email: null,
  member: null,
  memberChecked: false,
  mfaChecked: false,
  needsCode: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [member, setMember] = useState<AppUser | null>(null);
  const [memberChecked, setMemberChecked] = useState(false);
  const [mfa, setMfa] = useState({ userId: "", checked: false, needsCode: false });

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const email = session?.user.email ?? null;
  const userId = session?.user.id ?? "";

  // Two-step login: a login with an authenticator app must enter its code before anything loads
  // (the database refuses it until then). Reads the session, no network call.
  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setMfa({ userId: "", checked: true, needsCode: false });
      return;
    }
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2")
      // If the check itself fails, carry on: the database still refuses a session without its code.
      .catch(() => false)
      .then((needsCode) => {
        if (!cancelled) setMfa({ userId: session.user.id, checked: true, needsCode });
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const mfaChecked = mfa.checked && mfa.userId === userId;
  const needsCode = mfaChecked && mfa.needsCode;

  useEffect(() => {
    let cancelled = false;
    setMemberChecked(false);
    if (!email || !mfaChecked || needsCode) {
      setMember(null);
      setMemberChecked(true);
      return;
    }
    // RLS only returns this row when the email is on the team list.
    supabase
      .from("app_users")
      .select("*")
      .ilike("email", email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setMember((data as AppUser) ?? null);
        setMemberChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [email, mfaChecked, needsCode]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Live updates: changes from the bank feed or another device refresh what they touch.
  useLiveRefresh(!!member?.email);

  return (
    <AuthContext.Provider
      value={{
        ready,
        session,
        email,
        member,
        memberChecked,
        mfaChecked,
        needsCode,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function Splash({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[var(--screen-h)] flex-col items-center justify-center gap-4 bg-background">
      <SignedOutLogo />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Compass;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[var(--screen-h)] items-center justify-center bg-background px-4">
      <div className="panel max-w-md p-8 text-center">
        <div className="empty-icon mx-auto">
          <Icon />
        </div>
        <h1 className="mb-3 text-lg font-semibold">{title}</h1>
        <div className="space-y-3 text-xs leading-loose text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

const RETURN_KEY = "kane-books.returnTo";
function rememberReturn(href: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, href);
  } catch {
    // storage blocked: they land on the home screen instead
  }
}
function takeReturn(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : null;
  } catch {
    return null;
  }
}

/** Shows the app only to signed-in team members; everything else gets the right screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, session, member, memberChecked, mfaChecked, needsCode, email, signOut } =
    useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onLogin = path === "/login";

  useEffect(() => {
    if (!mounted || !ready || !isSupabaseConfigured) return;
    if (!session && !onLogin) {
      // Come back here after signing in (a deep link).
      if (path !== "/") rememberReturn(href);
      navigate({ to: "/login" });
    }
    if (session && onLogin && member) {
      const back = takeReturn();
      if (back) navigate({ href: back });
      else navigate({ to: "/" });
    }
  }, [mounted, ready, session, onLogin, member, navigate, path, href]);

  if (!mounted) return <Splash />;

  if (!isSupabaseConfigured) {
    return (
      <Notice icon={PlugZap} title="Database connection not set">
        <p>
          This build does not have the database address and public key (VITE_SUPABASE_URL and
          VITE_SUPABASE_PUBLISHABLE_KEY).
        </p>
        <p>Once they are set, reload this page.</p>
      </Notice>
    );
  }

  if (!ready) return <Splash />;
  if (session && !mfaChecked) return <Splash label="Checking access" />;
  if (session && needsCode) return <CodePrompt />;
  if (onLogin) return <>{children}</>;
  if (!session) return <Splash label="Redirecting to sign in" />;
  if (!memberChecked) return <Splash label="Checking access" />;

  if (!member) {
    return (
      <Notice icon={ShieldAlert} title="Not authorized">
        <p>
          You are signed in as <strong className="text-foreground">{email}</strong>, but this email
          is not allowed in Kane Books.
        </p>
        <p>These are private books. Sign in with the owner's email.</p>
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          <LogOut />
          Sign out
        </Button>
      </Notice>
    );
  }

  return <>{children}</>;
}
