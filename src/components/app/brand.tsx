import { BookOpenText } from "lucide-react";

/** The Kane Books wordmark, or just its mark for tight spots. */
export function BrandLogo({
  variant = "full",
  className = "",
}: {
  variant?: "full" | "mark";
  className?: string;
}) {
  if (variant === "mark")
    return <BookOpenText className={`size-7 text-brass ${className}`} aria-hidden />;
  return <div className={`wordmark ${className}`}>KANE BOOKS</div>;
}

/** Logo for screens shown before sign-in (sign-in page, loading screen). */
export function SignedOutLogo({ className = "" }: { className?: string }) {
  return <BrandLogo className={className} />;
}
