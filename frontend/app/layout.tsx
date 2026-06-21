import "./globals.css";
import Script from "next/script";

export const metadata = {
  title: "The Duck Pond — Agentic AI Training",
  description: "Learn agentic AI by doing your real work. Bikeluggage & Motoplanet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Google Identity Services for sign-in */}
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
        {/* animated pond background */}
        <div className="pond" aria-hidden="true">
          <div className="lily l1" /><div className="lily l2" />
          <div className="ripple r1" /><div className="ripple r2" /><div className="ripple r3" />
          <div className="duck-lane">
            <div className="duck-bob">
              <span className="duck-name">Pluma</span>
              <Duck size={74} />
              <div className="duck-wake" />
            </div>
          </div>
          <div className="duck-lane lane2">
            <div className="duck-bob"><Duck size={48} /></div>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}

function Duck({ size = 74 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="dbody" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#FFE27A" />
          <stop offset="55%" stopColor="#FFD23F" />
          <stop offset="100%" stopColor="#F2B705" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="64" rx="34" ry="24" fill="url(#dbody)" />
      <path d="M16 60 Q4 54 8 66 Q16 66 22 64 Z" fill="#F2B705" />
      <circle cx="70" cy="42" r="19" fill="url(#dbody)" />
      <circle cx="76" cy="38" r="3.4" fill="#23303a" />
      <circle cx="77.2" cy="36.8" r="1.1" fill="#fff" />
      <path d="M86 42 Q98 40 96 47 Q90 50 85 48 Z" fill="#F47A1F" />
      <path d="M44 60 Q56 50 66 62 Q56 70 46 66 Z" fill="#F7C53D" opacity=".9" />
    </svg>
  );
}
