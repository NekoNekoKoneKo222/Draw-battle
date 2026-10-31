import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DRAWMON | お絵描きAIカードバトル",
  description: "絵を描いてAI評価でカード化。コレクション・公開・オンライン対戦ができるWebゲーム。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
