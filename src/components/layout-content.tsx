/**
 * The page shell. Every surface is dark and brings its own header and footer
 * (the admin layout, the host header, the TV's bars), so this is only the
 * full-height column they sit in.
 */
export function LayoutContent({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-screen-safe flex-col">
      <main className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
