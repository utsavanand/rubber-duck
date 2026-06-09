// An orange rubber duck mark, used as the logo and as the fleet glyph. Inline
// SVG so it inherits size from surrounding text and needs no asset request.
// Built from overlapping ellipses (body, chest, head) so the silhouette reads
// as a duck at any size. `color` overrides the body fill for the hero fleet.
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
        <ellipse cx="30" cy="42" rx="24" ry="13" />
        <ellipse cx="38" cy="33" rx="12" ry="11" />
        <path d="M8 36c-4-2-7-1-8 2 3 2 6 2 8 1z" />
        <circle cx="44" cy="22" r="12" />
      </g>
      <path d="M55 21c5-1 8 0 9 3-2 2-5 3-9 3-1-2-1-4 0-6z" fill="#F5821F" />
      <circle cx="46" cy="19" r="2.4" fill="#1a1a1a" />
    </svg>
  );
}
