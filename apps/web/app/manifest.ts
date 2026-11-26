import type { MetadataRoute } from "next";

/** Lets a phone keep Kazusa on its home screen and open it as its own app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kazusa",
    short_name: "Kazusa",
    description:
      "Watch and take part in a living world of characters who get on with their lives.",
    start_url: "/",
    display: "standalone",
    background_color: "#16181f",
    theme_color: "#16181f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
