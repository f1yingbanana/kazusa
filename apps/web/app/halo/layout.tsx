import type { Metadata } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "@/features/legacy.css";

const rounded = M_PLUS_Rounded_1c({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Kazusa",
  description: "The Kazusa observer client, rebuilt on ui-sdk.",
};

/** The theme reads the typeface on <html>, where portaled popups can see it too. */
export default function NewClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style href="ui-font-face" precedence="default">
        {`html{--ui-font-face:${rounded.style.fontFamily}}`}
      </style>
      {children}
    </>
  );
}
