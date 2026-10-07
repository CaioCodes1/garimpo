import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "garimpo",
  description: "Pequenas empresas da sua cidade que provavelmente não têm site.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
