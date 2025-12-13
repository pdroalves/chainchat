"use client";

import { Suspense } from "react";
import { ChainChat } from "./_components/ChainChat";
import type { NextPage } from "next";

// Loading fallback for Suspense (required for useSearchParams in static export)
const LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-purple-500 flex items-center justify-center shadow-xl shadow-cyan-500/25 animate-pulse">
        <svg
          className="w-8 h-8 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
          />
        </svg>
      </div>
      <p className="text-white/40 text-sm">Loading ChainChat...</p>
    </div>
  </div>
);

const Home: NextPage = () => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ChainChat />
    </Suspense>
  );
};

export default Home;
