"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GitBranch } from "lucide-react";
import { getSession } from "@/lib/api/auth-client";

export function LoginClient() {
  const searchParams = useSearchParams();
  const [checkingSession, setCheckingSession] = useState(true);
  const next = searchParams.get("next") ?? "/investigations";
  const error = searchParams.get("error");

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then((session) => {
        if (!cancelled && session.authenticated) {
          window.location.href = next.startsWith("/") ? next : "/investigations";
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [next]);

  const signInHref = `/api/auth/github${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D2436] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1E4560] bg-[#123049] p-8 shadow-xl">
        <div className="mb-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#4F7590]">Cernix</p>
          <h1 className="mt-2 text-2xl font-semibold text-[#E9F3F8]">Sign in to continue</h1>
          <p className="mt-2 text-sm text-[#86ADC2]">
            Authenticate with GitHub to create and manage investigations.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-[#F2796B]/30 bg-[#F2796B]/10 px-4 py-3 text-sm text-[#F2796B]">
            Sign-in failed. Please try again.
          </div>
        )}

        <a
          href={signInHref}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#FF6B1A] px-4 py-3 text-sm font-medium text-[#0D2436] transition-colors hover:bg-[#ff7d35]"
        >
          <GitBranch className="h-4 w-4" aria-hidden />
          Continue with GitHub
        </a>

        <p className="mt-6 text-center text-xs text-[#4F7590]">
          Need to explore first?{" "}
          <Link href="/sample-report" className="text-[#86ADC2] underline-offset-2 hover:underline">
            View a sample report
          </Link>
        </p>

        {checkingSession && (
          <p className="mt-4 text-center text-xs text-[#4F7590]">Checking session…</p>
        )}
      </div>
    </div>
  );
}
