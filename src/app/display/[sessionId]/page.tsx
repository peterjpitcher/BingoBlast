import React from 'react';
import { notFound } from 'next/navigation';
import DisplayUI from './display-ui';
import { loadDisplay } from './load-display';

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The pub TV for one session. The paired /tv draws the same screen (load-display.ts). */
export default async function DisplayPage({ params, searchParams }: PageProps) {
  const { sessionId } = await params;
  const rehearsal = (await searchParams).rehearsal === '1';

  const loaded = await loadDisplay(sessionId, { rehearsal });
  if (loaded.kind === 'not_found') {
    notFound();
  }
  return <DisplayUI {...loaded.props} />;
}
