const PALETTE = [
  { bg: '#0055ff', fg: '#ffb830' },
  { bg: '#003fc0', fg: '#ffffff' },
  { bg: '#ffb830', fg: '#0d1b3d' },
  { bg: '#0d1b3d', fg: '#ffb830' },
]

/**
 * Branded stand-in for the 18 of 22 drinks with no photograph yet. Rendered as
 * inline SVG so it costs no request and scales cleanly; the colourway is picked
 * from the drink name so the same drink always looks the same, and a grid of
 * cards reads as varied rather than repetitive.
 */
export function DrinkPlaceholder({ name }: { name: string }) {
  const seed = [...name].reduce((n, c) => n + c.charCodeAt(0), 0)
  const { bg, fg } = PALETTE[seed % PALETTE.length]
  const initials = name
    .replace(/[^A-Za-z\s-]/g, '')
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <svg
      className="drink-media"
      viewBox="0 0 300 300"
      role="img"
      aria-label={`${name} — photo coming soon`}
    >
      <rect width="300" height="300" fill={bg} />
      {/* Cup silhouette: a tapered vessel, lid, and straw. Reads as a drink at
          card size without pretending to be a photograph of one. */}
      <g opacity="0.22" fill={fg}>
        <rect x="96" y="86" width="108" height="16" rx="8" />
        <rect x="150" y="40" width="9" height="52" rx="4" transform="rotate(14 154 66)" />
        <path d="M104 106 h92 l-13 122 a10 10 0 0 1 -10 9 h-46 a10 10 0 0 1 -10 -9 z" />
      </g>
      <text
        x="150" y="168"
        textAnchor="middle"
        fontSize="76"
        fontWeight="800"
        letterSpacing="-3"
        fill={fg}
        fontFamily="Inter, ui-rounded, system-ui, sans-serif"
      >
        {initials}
      </text>
      <text
        x="150" y="252"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        letterSpacing="3"
        fill={fg}
        opacity="0.75"
        fontFamily="Inter, ui-rounded, system-ui, sans-serif"
      >
        KENNKO
      </text>
    </svg>
  )
}
