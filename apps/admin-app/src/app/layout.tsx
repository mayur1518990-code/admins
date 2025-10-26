import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Admin Portal - Document Management",
  description: "Admin and agent portal for document management",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
