import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI 경매 에이전트",
  description: "AI가 분석해주는 똑똑한 부동산 경매",
};

import Link from "next/link";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${inter.className} bg-gray-50 text-gray-900 min-h-screen flex justify-center`}>
        <div className="w-full max-w-md sm:max-w-lg md:max-w-xl lg:max-w-2xl bg-white min-h-screen shadow-2xl relative overflow-x-hidden border-x border-gray-200">
          <nav className="border-b border-gray-200 bg-white/95 backdrop-blur-md px-4 py-3 sticky top-0 z-30 flex justify-between items-center shadow-sm">
            <Link href="/" className="font-bold text-base tracking-tight text-gray-900 flex items-center gap-1.5 hover:opacity-80 transition-opacity">
              <span className="text-blue-600">⚡️</span> AI 경매 에이전트
            </Link>
            <div className="flex items-center gap-1.5">
              <Link href="/" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-700 transition-colors">
                홈
              </Link>
              <Link href="/planner" className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 shadow-2xs flex items-center gap-1 transition-all">
                <span>📍</span> <span>임장 플래너</span>
              </Link>
              <Link href="/auctions?src=results" className="text-xs font-black px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 shadow-2xs flex items-center gap-1 transition-all">
                <span>🏆</span> <span>낙찰결과</span>
              </Link>
              <Link href="/auctions" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm flex items-center gap-1 transition-colors">
                🔍 매물검색
              </Link>
            </div>
          </nav>
          <main className="p-4 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
