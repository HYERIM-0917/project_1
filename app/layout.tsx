import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "minutes.ai — 전사문을 실행 가능한 회의록으로",
  description: "회의 전사문을 OpenAI 또는 Gemini로 사실 기반 회의록으로 정리합니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
