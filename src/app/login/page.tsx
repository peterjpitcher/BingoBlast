'use client';

import React, { Suspense, useState, useTransition } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { login, signup } from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function LoginPageContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const router = useRouter();
  
  const [isPending, startTransition] = useTransition();
  const missingSupabaseConfig = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [error, setError] = useState<string | null>(
    missingSupabaseConfig
      ? "Configuration Error: Missing Supabase Environment Variables. Please check your .env.local file."
      : null
  );
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    
    const formData = new FormData(event.currentTarget);
    formData.append('next', next);

    startTransition(async () => {
      const action = mode === 'login' ? login : signup;
      const result = await action(formData);
      if (!result?.success) {
        setError(result?.error || "Authentication failed. Please try again.");
      } else if (result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  };

  return (
    <div className="min-h-screen-safe flex flex-col items-center justify-center p-4 bg-gradient-to-b from-[#005131] to-[#003f27]">
      <div className="mb-8 relative w-48 h-24 rounded-xl bg-[#005131] border border-[#1f7c58] p-3 shadow-lg shadow-black/25">
         <Image 
          src="/the-anchor-pub-logo-white-transparent.png" 
          alt="The Anchor" 
          fill 
          className="object-contain p-2"
          priority
        />
      </div>

      <Card className="w-full max-w-md border-[#1f7c58] shadow-2xl shadow-black/30 bg-[#005131]/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-center text-2xl text-[#f5f1e6] font-bold">
            {mode === 'login' ? 'Welcome Back' : 'Join the Party'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-md">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-50/90" htmlFor="email">
                Email address
              </label>
              <Input 
                id="email"
                name="email" 
                type="email" 
                placeholder="Enter email" 
                required 
                className="bg-[#003f27]/70 border-[#2f8f6a] focus:border-[#a57626]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-50/90" htmlFor="password">
                Password
              </label>
              <Input 
                id="password"
                name="password" 
                type="password" 
                placeholder="Password" 
                required 
                className="bg-[#003f27]/70 border-[#2f8f6a] focus:border-[#a57626]"
              />
            </div>

            <div className="pt-2 space-y-3">
              <Button 
                type="submit" 
                className="w-full" 
                size="lg"
                isLoading={isPending}
              >
                {mode === 'login' ? 'Sign In' : 'Sign Up'}
              </Button>
              
              <button
                type="button"
                className="w-full text-sm text-emerald-100/80 hover:text-[#f5f1e6] transition-colors"
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              >
                {mode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#f5f1e6] bg-[#005131]">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
