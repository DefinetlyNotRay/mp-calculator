import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Powerforge — SkyBlock MP Optimizer",
  description:
    "Find your next Magical Power upgrade using live Hypixel markets and a state-aware optimizer.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
