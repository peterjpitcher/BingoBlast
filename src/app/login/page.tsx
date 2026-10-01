'use client';

import React, { Suspense, useState, useTransition } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { login } from './actions';
import { BrandBackdrop } from '@/components/brand-backdrop';
import { CopyrightLine } from '@/components/copyright-line';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, fieldLabelClass } from '@/components/ui/input';
import { AnchorLogo } from '@/components/ui/logo';

function LoginPageContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const missingSupabaseConfig = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [error, setError] = useState<string | null>(
    missingSupabaseConfig
      ? "Configuration error: the Supabase environment variables are missing. Check your .env.local file."
      : null
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.append('next', next);

    startTransition(async () => {
      const result = await login(formData);
      if (!result?.success) {
        setError(result?.error || "We could not sign you in. Please try again.");
      } else if (result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  };

  const hasError = Boolean(error);

  return (
    <div className="relative flex min-h-screen-safe flex-col overflow-hidden bg-anchor-green-deep">
      <BrandBackdrop />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="flex flex-col items-center gap-3 text-center">
          <AnchorLogo height={80} priority />
          <span className="font-script text-[32px] text-anchor-gold-bright">Welcome back</span>
        </div>

        <Card accent className="px-5 py-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-1">
              <h1 className="text-[28px] leading-[1.05] text-anchor-cream-text">Staff sign in</h1>
              <p className="text-sm text-anchor-sage">Accounts are invite only. Ask an admin if you need one.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className={fieldLabelClass} htmlFor="email">
                Email address
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@the-anchor.pub"
                required
                aria-invalid={hasError}
                aria-describedby={hasError ? 'login-error' : undefined}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className={fieldLabelClass} htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                aria-invalid={hasError}
                aria-describedby={hasError ? 'login-error' : undefined}
              />
            </div>

            <Button type="submit" size="lg" block className="mt-1" isLoading={isPending}>
              Sign in
            </Button>

            {error && (
              <p id="login-error" role="alert" className="text-sm text-anchor-danger-text">
                {error}
              </p>
            )}
          </form>
        </Card>

        <CopyrightLine />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen-safe items-center justify-center bg-anchor-green-deep text-anchor-cream-text">Loading…</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
