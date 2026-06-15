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
      <ellipse cx="30" cy="42" rx="24" ry="13"/>
      <ellipse cx="38" cy="33" rx="12" ry="11"/>
      <path d="M8 36c-4-2-7-1-8 2 3 2 6 2 8 1z"/>
      <circle cx="44" cy="22" r="12"/>
    </g>
    <path d="M55 21c5-1 8 0 9 3-2 2-5 3-9 3-1-2-1-4 0-6z" fill="#F5821F"/>
    <circle cx="46" cy="19" r="2.4" fill="#1a1a1a"/>
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
        background: "#0d0d0d",
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
        One window over every AI coding agent you run — local-first.
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
