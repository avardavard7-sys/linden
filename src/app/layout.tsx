import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import SWRegister from "@/components/SWRegister";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Linden — расчётный центр",
  description: "Расчёт стоимости мебели, сметы, договоры и производственные документы за минуты.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png"
  },
  appleWebApp: {
    capable: true,
    title: "Linden",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#211A12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap&subset=cyrillic"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">
        <ToastProvider>
          <AuthGate>{children}</AuthGate>
        </ToastProvider>
        <SWRegister />
      </body>
    </html>
  );
}
