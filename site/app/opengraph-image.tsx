// The social-preview card shown when the site link is shared (Slack, Twitter,
// iMessage, etc.). Next renders this to a 1200×630 PNG at build time and wires
// the og:image / twitter:image tags automatically — no binary asset to keep in
// sync. The card matches the site brand: the orange duck + the hero headline on
// the dark background.
import { ImageResponse } from "next/og";

export const alt = "RubberDuckHQ — headquarters for your team of agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The brand duck (from Duck.tsx) as a standalone SVG, embedded as a data URI —
// Satori (the OG renderer) takes <img>, not inline <svg>.
const DUCK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="160" height="160">
    <g fill="#FFB020">
      <ellipse cx="30" cy="42" rx="22" ry="14"/>
      <circle cx="41" cy="26" r="13"/>
    </g>
    <path d="M51 22.5c6 0 9.8 1.8 9.8 4.2S57 31 51 31c-1.5-2.8-1.5-5.7 0-8.5z" fill="#F5821F"/>
    <circle cx="43" cy="23" r="2.6" fill="#1a1a1a"/>
  </svg>`,
)}`;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        // Softer than flat black: a gentle dark gradient with a warm duck-orange
        // glow in the corner so the card feels less heavy.
        background:
          "radial-gradient(900px circle at 82% 18%, rgba(245,130,31,0.16), transparent 60%), linear-gradient(135deg, #14161c 0%, #0f1116 100%)",
        padding: "0 90px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          marginBottom: 40,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={DUCK} width={120} height={120} alt="" />
        <span style={{ fontSize: 56, fontWeight: 700, color: "#f5f5f5" }}>
          RubberDuckHQ
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 84,
          fontWeight: 800,
          color: "#ffffff",
          lineHeight: 1.05,
        }}
      >
        <div>Headquarters for your</div>
        <div>team of agents.</div>
      </div>
      <div
        style={{ fontSize: 34, color: "#9a9aa0", marginTop: 36, maxWidth: 940 }}
      >
        One window over every AI coding agent you run. Local-first.
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 56,
          right: 90,
          fontSize: 28,
          color: "#f5821f",
          fontWeight: 600,
        }}
      >
        github.com/utsavanand/rubber-duck
      </div>
    </div>,
    size,
  );
}
