import type { Metadata } from "next";
import { M_PLUS_Rounded_1c, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import "./lab.css";

const rounded = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-rounded",
});
const kaku = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-kaku",
});
const mincho = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-mincho",
});

export const metadata: Metadata = {
  title: "Kazusa — Style lab",
  description: "Exploring ui-sdk with three anime-flavoured styles and swappable palettes.",
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${rounded.variable} ${kaku.variable} ${mincho.variable}`}>{children}</div>;
}
