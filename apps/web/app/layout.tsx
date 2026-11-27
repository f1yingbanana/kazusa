import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

const rounded = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Kazusa",
  description:
    "Watch and take part in a living world of characters who get on with their lives.",
  appleWebApp: { capable: true, title: "Kazusa", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#16181f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-ui-ground">
      <body className="antialiased">
        {/* The theme reads the typeface on <html>, where portaled popups see it too. */}
        <style href="ui-font-face" precedence="default">
          {`html{--ui-font-face:${rounded.style.fontFamily}}`}
        </style>
        <NuqsAdapter
          defaultOptions={{ history: "push", shallow: true, scroll: false }}
        >
          {children}
        </NuqsAdapter>
        {/* Vercel serves its script only to its own deployments; anywhere
            else (a desktop install, a tunnel) asking for it is a 404. */}
        {process.env.NODE_ENV === "production" && process.env.VERCEL && (
          <Analytics />
        )}
      </body>
    </html>
  );
}
