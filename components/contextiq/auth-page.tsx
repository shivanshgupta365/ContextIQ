"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

import { ContextIQLogo } from "@/components/contextiq/logo";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthPage({
  intent = "sign_in",
  returnTo = "/overview",
}: {
  intent?: "sign_in" | "gmail_connect" | "outlook_connect";
  returnTo?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGoogle = () => {
    startTransition(async () => {
      setError(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?intent=${intent}&provider=google&next=${encodeURIComponent(returnTo)}`,
            queryParams: {
              access_type: "offline",
              prompt: "consent",
              include_granted_scopes: "true",
            },
            scopes:
              "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose",
          },
        });

        if (authError) {
          setError(authError.message);
        }
      } catch {
        setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      }
    });
  };

  const handleMicrosoft = () => {
    startTransition(async () => {
      setError(null);

      try {
        const supabase = getSupabaseBrowserClient();
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: "azure",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?intent=${intent}&provider=microsoft&next=${encodeURIComponent(returnTo)}`,
            scopes: "openid profile email offline_access Mail.Read User.Read",
          },
        });

        if (authError) {
          setError(authError.message);
        }
      } catch {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        );
      }
    });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6 font-sans text-[#0F172A]">
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)",
        }}
      />

      <Link
        href="/"
        className="group absolute left-8 top-8 z-20 flex items-center gap-2 text-[13px] font-bold text-slate-500 transition-colors hover:text-[#0F172A]"
      >
        <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
        Back to home
      </Link>

      <div className="relative z-10 w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white p-10 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        <div className="mb-8 flex flex-col items-center text-center">
          <ContextIQLogo className="mb-5 h-14 w-14 rounded-2xl shadow-[0_4px_12px_rgba(15,23,42,0.15)]" />
          <h2 className="text-[24px] font-extrabold tracking-tight text-[#0F172A]">
            {intent === "gmail_connect"
              ? "Connect Gmail"
              : intent === "outlook_connect"
                ? "Connect Outlook"
                : "Private workspace sign-in"}
          </h2>
          <p className="mt-1 text-[14px] font-medium text-slate-500">
            {intent === "gmail_connect"
              ? "Grant Gmail read access so ContextIQ can sync inbox, archived, and starred email context."
              : intent === "outlook_connect"
                ? "Grant Outlook mail read access so ContextIQ can sync Microsoft 365 email context."
              : "Sign in with Google for full workspace access. Walk-in experience stays available."}
          </p>
        </div>

        <div className="space-y-3">
          {intent !== "outlook_connect" ? (
            <button
              type="button"
              onClick={handleGoogle}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-bold text-[#0F172A] shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M21.35 11.1h-9.18v2.98h5.28c-.23 1.52-1.94 4.45-5.28 4.45-3.18 0-5.76-2.63-5.76-5.88s2.58-5.88 5.76-5.88c1.81 0 3.02.77 3.71 1.43l2.53-2.45C16.81 4.27 14.7 3.3 12.17 3.3 7.22 3.3 3.2 7.33 3.2 12.3s4.02 9 8.97 9c5.18 0 8.61-3.64 8.61-8.77 0-.59-.06-1.03-.14-1.43Z"
                  fill="#0F172A"
                />
              </svg>
              {intent === "gmail_connect" ? "Connect Google + Gmail" : "Continue with Google"}
            </button>
          ) : null}

          {intent === "sign_in" || intent === "outlook_connect" ? (
            <button
              type="button"
              onClick={handleMicrosoft}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-bold text-[#0F172A] shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {intent === "outlook_connect" ? "Connect Microsoft + Outlook" : "Continue with Microsoft"}
            </button>
          ) : null}

          {intent === "sign_in" ? (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Or
              </span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          ) : null}

          {intent === "sign_in" ? (
            <Link
              href={"/walk-in/enter" as Route}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-bold text-[#0F172A] shadow-sm transition-colors hover:bg-slate-50"
            >
              Enter Walk-In Experience
            </Link>
          ) : null}
        </div>
        {error ? (
          <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="mt-8 flex items-center justify-center gap-3 border-t border-slate-200 pt-6">
          <Link
            href={"/privacy-policy" as Route}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:bg-slate-50"
          >
            Privacy Policy
          </Link>
          <Link
            href={"/terms-of-service" as Route}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:bg-slate-50"
          >
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  );
}
