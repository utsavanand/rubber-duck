// An orange rubber duck mark, used as the logo. Inline SVG so it inherits size
// from the surrounding text and needs no asset request.
export function Duck({ size = 28 }: { size?: number }) {
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
      {/* body */}
      <path
        d="M14 40c0-9 7-15 16-15 4 0 7 1 10 3 2-7 1-13-2-17 6 1 11 6 12 13 6 1 10 5 10 10 0 8-9 14-23 14-13 0-23-3-23-8z"
        fill="#FFB020"
      />
      {/* head highlight */}
      <path
        d="M40 28c-2-2-5-3-9-3-7 0-12 4-14 9 2-9 9-15 18-15 2 4 3 6 5 9z"
        fill="#FFC247"
      />
      {/* beak */}
      <path d="M2 28l12-1-3 6-9-2c-1 0-1-2 0-3z" fill="#F5821F" />
      {/* eye */}
      <circle cx="20" cy="22" r="2.6" fill="#1a1a1a" />
      {/* water line */}
      <path
        d="M8 50h48"
        stroke="#FFB020"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
