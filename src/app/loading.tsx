export default function Loading() {
  return (
    <main className="min-h-screen bg-background px-6 pb-14 pt-10 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="h-7 w-24 animate-pulse rounded-full bg-muted" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="card-surface p-6">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-surface/70 px-4 py-3 ring-1 ring-border/70"
                >
                  <div className="space-y-2">
                    <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-60 animate-pulse rounded bg-muted/80" />
                  </div>
                  <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-6 space-y-3">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-6 w-56 animate-pulse rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-2xl bg-surface/70 ring-1 ring-border/70" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
