import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { JiraHeaderSync } from "@/components/jira-header-sync";
import { SidebarNav } from "@/components/sidebar-nav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Initiative Resource Planner",
  description: "Plan and track initiative resource allocations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-screen flex-col bg-[var(--page-background)] font-sans">
        <header
          className="flex h-12 w-full shrink-0 items-center justify-between gap-3 px-4 text-white"
          style={{ backgroundColor: "var(--primary-blue)" }}
        >
          <span className="min-w-0 shrink text-sm font-medium">Initiative Resource Planner</span>
          <JiraHeaderSync />
        </header>
        <div className="flex min-h-0 min-w-0 flex-1">
          <SidebarNav />
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col p-4"
            style={{ backgroundColor: "var(--page-background)" }}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-neutral-200/80 bg-white">
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
