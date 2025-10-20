import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Admin Portal - Document Management",
  description: "Admin and agent portal for document management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
