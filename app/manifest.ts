import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "師生聯絡簿",
    short_name: "聯絡簿",
    description: "老師發布課後紀錄，學生即時接收通知。",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f2e9",
    theme_color: "#244c3a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
