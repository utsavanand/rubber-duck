// An orange rubber duck mark, used as the logo and as the fleet glyph. Inline
// SVG so it inherits size from surrounding text and needs no asset request.
// The clean no-tail silhouette (chunky body + round head + flat bill) is the
// single brand duck, matching the dashboard favicon and the README mark.
// `color` overrides the body fill for the hero fleet.
export function Duck({ size = 28, color }: { size?: number; color?: string }) {
  const body = color ?? "#FFB020";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Rubber duck"
      role="img"
    >
      <g fill={body}>
        <ellipse cx="30" cy="42" rx="22" ry="14" />
        <circle cx="41" cy="26" r="13" />
      </g>
      <path
        d="M51 22.5c6 0 9.8 1.8 9.8 4.2S57 31 51 31c-1.5-2.8-1.5-5.7 0-8.5z"
        fill="#F5821F"
      />
      <circle cx="43" cy="23" r="2.6" fill="#1a1a1a" />
    </svg>
  );
}
