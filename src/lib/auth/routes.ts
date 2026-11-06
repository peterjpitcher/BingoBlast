// Where each staff role lands after sign-in, shared by the proxy (which cannot
// import server-only code) and src/lib/auth/server.ts.
export const HOME_FOR_ROLE = { admin: '/admin', host: '/host' } as const
