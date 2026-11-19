// A cartoon iced drink in the style of the food-menu flyer: ink keyline, flat fills, a little face,
// sitting on a coloured plate. Drawn in SVG so one component covers every drink colour and stays
// sharp at any size. Decorative: callers label the surrounding card, so the SVG is aria-hidden.

export type CupFlavour = 'coffee' | 'caramel' | 'strawberry' | 'matcha' | 'choco'

const FLAVOURS: Record<CupFlavour, { drink: string; foam: string }> = {
  coffee: { drink: '#8a5a3c', foam: '#f3e2cf' },
  caramel: { drink: '#c98a3e', foam: '#fff1d6' },
  strawberry: { drink: '#f77293', foam: '#fff0f3' },
  matcha: { drink: '#7fb069', foam: '#eef7e6' },
  choco: { drink: '#5b3a2e', foam: '#e9d7c8' },
}

const PLATES = {
  pink: 'var(--plate-pink)',
  orange: 'var(--plate-orange)',
  yellow: 'var(--plate-yellow)',
  sky: 'var(--sky)',
} as const

export type CupPlate = keyof typeof PLATES

type Props = {
  flavour: CupFlavour
  plate?: CupPlate
  className?: string
}

export function CupSticker({ flavour, plate = 'yellow', className }: Props) {
  const { drink, foam } = FLAVOURS[flavour]
  const clipId = `cup-${flavour}-${plate}`
  const ink = 'var(--ink)'

  return (
    <svg className={className} viewBox="0 0 160 170" aria-hidden="true" focusable="false">
      <ellipse cx="80" cy="150" rx="74" ry="16" fill={PLATES[plate]} stroke={ink} strokeWidth="3" />

      {/* straw */}
      <path d="M92 6 L104 10 L92 52 L82 50 Z" fill="var(--white)" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M95 18 L101 20 M92 30 L98 32" stroke="var(--plate-pink)" strokeWidth="4" strokeLinecap="round" />

      <clipPath id={clipId}>
        <path d="M38 46 L122 46 L112 146 Q80 154 48 146 Z" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="30" y="40" width="100" height="120" fill={drink} />
        <rect x="30" y="40" width="100" height="34" fill={foam} />
        <path d="M30 74 Q46 66 58 74 T86 74 T114 74 T140 74 L140 80 L30 80 Z" fill={foam} />
        <rect x="52" y="92" width="18" height="16" rx="4" fill="var(--white)" opacity="0.45" />
        <rect x="90" y="104" width="16" height="14" rx="4" fill="var(--white)" opacity="0.45" />
      </g>
      <path d="M38 46 L122 46 L112 146 Q80 154 48 146 Z" fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />

      {/* lid */}
      <path d="M32 46 Q80 22 128 46 Z" fill="var(--white)" fillOpacity="0.75" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />
      <rect x="28" y="42" width="104" height="9" rx="4.5" fill="var(--white)" stroke={ink} strokeWidth="3.5" />

      {/* face */}
      <ellipse cx="66" cy="110" rx="8" ry="9.5" fill="var(--white)" stroke={ink} strokeWidth="2.5" />
      <ellipse cx="94" cy="110" rx="8" ry="9.5" fill="var(--white)" stroke={ink} strokeWidth="2.5" />
      <circle cx="68" cy="112" r="4" fill={ink} />
      <circle cx="96" cy="112" r="4" fill={ink} />
      <path d="M72 126 Q80 134 88 126" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="58" cy="124" rx="5" ry="3" fill="var(--plate-pink)" opacity="0.7" />
      <ellipse cx="102" cy="124" rx="5" ry="3" fill="var(--plate-pink)" opacity="0.7" />
    </svg>
  )
}
