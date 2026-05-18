export default function FullPageLoader() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute h-14 w-14 rounded-full border-4 border-border" />
          <div className="absolute h-14 w-14 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>

        <div className="text-center">
          <p className="font-outfit text-xl font-semibold tracking-[0.18em] text-foreground/90">
            VANTAHIRE
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Loading workspace...
          </p>
        </div>
      </div>
    </div>
  );
}
