import type { Metadata } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "./halo.css";

const rounded = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-rounded",
});

export const metadata: Metadata = {
  title: "Kazusa — Halo",
  description: "The Kazusa observer client, rebuilt in the Halo style with ui-sdk.",
};

export default function HaloLayout({ children }: { children: React.ReactNode }) {
  return <div className={rounded.variable}>{children}</div>;
}
