import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetNote | AI 회의록 자동 작성",
  description: "회의 전사문을 실무형 회의록으로 정리하는 간결한 AI 도구",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
