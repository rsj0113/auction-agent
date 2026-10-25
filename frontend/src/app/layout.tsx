import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "올인원 경공매·부동산 AI | 경매·공매·낙찰·시세 종합 분석",
  description: "법원경매, 온비드 공매, 네이버 실매물 시세, 실거래 낙찰가를 한곳에서 AI로 분석하는 올인원 부동산 투자 플랫폼",
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
        <div className="w-full max-w-md sm:max-w-xl md:max-w-3xl lg:max-w-5xl bg-white min-h-screen shadow-2xl relative overflow-x-hidden border-x border-gray-200">
          <nav className="border-b border-gray-200 bg-white/95 backdrop-blur-md px-3 sm:px-5 py-2.5 sm:py-3 sticky top-0 z-30 flex justify-between items-center shadow-xs">
            <Link href="/" className="font-extrabold text-sm sm:text-base tracking-tight text-gray-900 flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0">
              <span className="text-base sm:text-lg">🏢</span>
              <span>올인원 부동산 AI</span>
              <span className="hidden md:inline text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">경매·공매·낙찰</span>
            </Link>
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <Link href="/auctions?source=results" className="text-[11px] sm:text-xs font-black px-2 sm:px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 shadow-2xs flex items-center gap-1 transition-all whitespace-nowrap">
                <span>🏆</span> <span className="hidden sm:inline">낙찰결과</span>
              </Link>
              <Link href="/auctions?view=map" className="text-[11px] sm:text-xs font-black px-2 sm:px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 shadow-2xs flex items-center gap-1 transition-all whitespace-nowrap">
                <span>🗺️</span> <span>지도</span>
              </Link>
              <Link href="/planner" className="text-[11px] sm:text-xs font-bold px-2 sm:px-2.5 py-1.5 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 shadow-2xs flex items-center gap-1 transition-all whitespace-nowrap">
                <span>📍</span> <span className="hidden xs:inline">임장</span>
              </Link>
              <Link href="/auctions" className="text-[11px] sm:text-xs font-bold px-2 sm:px-3 py-1.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-xs flex items-center gap-1 transition-colors whitespace-nowrap">
                <span>🔍</span> <span>목록</span>
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
