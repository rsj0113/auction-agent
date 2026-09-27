import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI 경매 에이전트",
  description: "AI가 분석해주는 똑똑한 부동산 경매",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${inter.className} bg-gray-50 text-gray-900 min-h-screen flex justify-center`}>
        <div className="w-full max-w-md bg-white min-h-screen shadow-2xl relative overflow-x-hidden border-x border-gray-200">
          <nav className="border-b border-gray-200 bg-white/90 backdrop-blur-md p-4 sticky top-0 z-10">
            <div className="flex justify-between items-center">
              <div className="font-bold text-lg tracking-tight text-gray-900 flex items-center gap-2">
                <span className="text-blue-600">⚡️</span> AI 경매 에이전트
              </div>
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
