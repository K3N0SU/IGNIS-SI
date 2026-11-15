import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "IGNIS-SI // ISS-DESTINY CIR-FLEX2",
  description: "Microgravity spacecraft fire-safety workbench: cool-flame detection, ventilation re-ignition prediction and ECLSS response.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
