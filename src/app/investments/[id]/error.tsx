"use client";

import Link from "next/link";

export default function InvestmentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-6">
      <p className="text-destructive text-center text-sm">{error.message || "Something went wrong."}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="text-primary text-sm font-medium underline underline-offset-4"
        >
          Try again
        </button>
        <Link href="/investments" className="text-muted-foreground text-sm underline underline-offset-4">
          Back to investments
        </Link>
      </div>
    </div>
  );
}
