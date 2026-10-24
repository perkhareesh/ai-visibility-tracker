import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Visibility Tracker", template: "%s · AI Visibility Tracker" },
  description: "Track how brands appear and get cited in AI-generated answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap"
        />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
