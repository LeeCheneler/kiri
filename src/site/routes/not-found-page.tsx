/**
 * Catch-all for unknown routes.
 */
export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl px-8 py-24">
      <h1 className="font-display text-4xl text-ink">Not found</h1>
      <p className="mt-4 font-mono text-sm text-ink-muted">
        That page doesn't exist. <a href="/">Head home</a>.
      </p>
    </main>
  );
}
