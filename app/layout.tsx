import type { Metadata } from "next";
import Sidebar from "./components/Sidebar";
import ToolHeader from "./components/ToolHeader";
import NeuronFx from "./components/NeuronFx";
import ConnectorOnboarding from "./components/ConnectorOnboarding";
import FigmaAppLinks from "./components/FigmaAppLinks";
import { SidebarProvider } from "./components/SidebarSlot";
import SessionProviderWrapper from "./components/SessionProviderWrapper";
import "./globals.css";
import { wordmarkFontsHref } from "@/lib/wordmarkFonts";

// Neuron-style type: Fahkwang for headings/buttons, DM Sans for body.
// Loaded as a stylesheet (not next/font) so the build never depends on
// reaching Google Fonts; globals.css maps the names onto the font tokens.
// Archivo is the AF1 web stand-in for Audi TRN (af1-brand skill); Fahkwang
// stays for the Neuron-style small caps labels.
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Fahkwang:wght@400;500;600&display=swap";

export const metadata: Metadata = {
  title: "AF1 Ktulu",
  description: "Internal tools for audif1.com: UTM Studio, SEO Studio, Asset Uploader, CRM Images",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
        <link rel="stylesheet" href={wordmarkFontsHref()} />
      </head>
      <body>
        <SessionProviderWrapper>
          <SidebarProvider>
          {/* Header spans the full width; the sidebar is in-tool navigation
              under it, the main column takes the rest. */}
          <NeuronFx />
          <ConnectorOnboarding />
          <FigmaAppLinks />
          <ToolHeader />
          <div style={{ display: "flex", minHeight: "calc(100vh - 64px)" }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, padding: "28px 36px" }}>{children}</main>
          </div>
          </SidebarProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
