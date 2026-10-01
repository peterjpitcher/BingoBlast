import type { Metadata } from "next";
import { Clicker_Script, DM_Serif_Display, Outfit } from "next/font/google";
import "./globals.css";
import { LayoutContent } from "@/components/layout-content";

// The Anchor brand type. DM Serif Display carries headlines, prize figures and
// large counts; it has one weight and is never faux-bolded. Outfit is the body
// and every numeral on a ball. Clicker Script is the brand line and the warm
// asides, used sparingly.
const displayFont = DM_Serif_Display({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const bodyFont = Outfit({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const scriptFont = Clicker_Script({
  variable: "--font-script",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Anchor Bingo",
  description: "Pub Bingo Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${scriptFont.variable}`}>
      <body>
        <LayoutContent>
          {children}
        </LayoutContent>
      </body>
    </html>
  );
}
