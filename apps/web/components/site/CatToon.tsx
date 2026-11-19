// Cartoon cats in the food-menu flyer's style (ink keyline, flat fills) that perch on the page's
// cards: peeking over an edge, climbing a side, sitting or napping on top. Coats follow the
// projector wall's cats (wall/public/scene/sprites.mjs) so the website and the wall share one cast.
// Decorative: aria-hidden.
//
// Each pose's viewBox puts the card edge it rests on at a fixed line, so CSS can pin that line to
// the card's edge (see .perch-* in app/landing.css):
//   peek  0 0 120 92   edge at y = 84 (the paws grip it)
//   sit   0 0 120 150  edge at y = 146 (the paws stand on it)
//   wave  0 0 120 150  edge at y = 146
//   nap   0 0 160 110  edge at y = 70 (the tail hangs over it)

export type CatCoat = 'ginger' | 'cream' | 'tuxedo' | 'tabby' | 'black' | 'calico'
export type CatPose = 'peek' | 'sit' | 'wave' | 'nap'

type Coat = { fur: string; dark: string; belly: string; patch?: string }

const COATS: Record<CatCoat, Coat> = {
  ginger: { fur: '#f2a03c', dark: '#c9701c', belly: '#fff3df' },
  cream: { fur: '#f6dba8', dark: '#e2bb78', belly: '#fffaf0' },
  tuxedo: { fur: '#343846', dark: '#343846', belly: '#ffffff' },
  tabby: { fur: '#a4a9b8', dark: '#6f7489', belly: '#f3f4f8' },
  black: { fur: '#3b3d4d', dark: '#3b3d4d', belly: '#3b3d4d' },
  calico: { fur: '#fbf6ea', dark: '#4a4350', belly: '#ffffff', patch: '#f09a3e' },
}

const INK = 'var(--ink)'
const PINK = 'var(--plate-pink)'
const WHITE = 'var(--white)'

type Props = { coat: CatCoat; pose: CatPose; className?: string }

export function CatToon({ coat, pose, className }: Props) {
  const c = COATS[coat]
  const striped = coat === 'ginger' || coat === 'tabby'
  const viewBox = pose === 'peek' ? '0 0 120 92' : pose === 'nap' ? '0 0 160 110' : '0 0 120 150'

  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      {pose === 'peek' ? <Peek c={c} striped={striped} tuxedo={coat === 'tuxedo'} /> : null}
      {pose === 'sit' || pose === 'wave' ? (
        <Sitting c={c} striped={striped} tuxedo={coat === 'tuxedo'} wave={pose === 'wave'} />
      ) : null}
      {pose === 'nap' ? <Nap c={c} striped={striped} /> : null}
    </svg>
  )
}

type PartProps = { c: Coat; striped: boolean; tuxedo?: boolean }

/** Fur stroke over a wider ink stroke: a limb or tail with a keyline. */
function Limb({ d, fur }: { d: string; fur: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d={d} fill="none" stroke={fur} strokeWidth="7" strokeLinecap="round" />
    </>
  )
}

/** Ears, head and face, centred on (60, cy). Eyes look up a little when `lookUp`. */
function Head({ c, striped, tuxedo, cy, lookUp = false }: PartProps & { cy: number; lookUp?: boolean }) {
  const y = cy - 58
  const pupil = lookUp ? -2 : 2
  return (
    <g transform={`translate(0 ${y})`}>
      <path d="M28 46 L30 12 L54 34 Z" fill={c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M34 38 L35 22 L46 33 Z" fill={PINK} />
      <path d="M92 46 L90 12 L66 34 Z" fill={c.patch ?? c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M86 38 L85 22 L74 33 Z" fill={PINK} />
      <ellipse cx="60" cy="58" rx="35" ry="28" fill={c.fur} stroke={INK} strokeWidth="3.5" />
      {c.patch ? <path d="M62 31 Q90 32 94 56 Q80 52 66 46 Z" fill={c.patch} /> : null}
      {striped ? <path d="M52 33 L54 42 M60 31 L60 41 M68 33 L66 42" stroke={c.dark} strokeWidth="3.5" strokeLinecap="round" /> : null}
      {tuxedo ? <path d="M50 66 Q60 54 70 66 Q72 82 60 84 Q48 82 50 66 Z" fill="#ffffff" /> : null}
      <ellipse cx="47" cy="57" rx="7" ry="8.5" fill={WHITE} stroke={INK} strokeWidth="2.5" />
      <ellipse cx="73" cy="57" rx="7" ry="8.5" fill={WHITE} stroke={INK} strokeWidth="2.5" />
      <circle cx="48.5" cy={57 + pupil} r="3.8" fill={INK} />
      <circle cx="74.5" cy={57 + pupil} r="3.8" fill={INK} />
      <circle cx="47.5" cy={55 + pupil} r="1.2" fill={WHITE} />
      <circle cx="73.5" cy={55 + pupil} r="1.2" fill={WHITE} />
      <path d="M56 68 L64 68 L60 73 Z" fill={PINK} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M54 76 Q57 80 60 76 Q63 80 66 76" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="38" cy="70" rx="5" ry="3" fill={PINK} opacity="0.7" />
      <ellipse cx="82" cy="70" rx="5" ry="3" fill={PINK} opacity="0.7" />
      <path d="M36 64 L14 59 M36 69 L14 70 M84 64 L106 59 M84 69 L106 70" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </g>
  )
}

function Paw({ cx, cy, fill }: { cx: number; cy: number; fill: string }) {
  return (
    <>
      <ellipse cx={cx} cy={cy} rx="11" ry="7" fill={fill} stroke={INK} strokeWidth="3" />
      <path d={`M${cx - 4} ${cy - 4} L${cx - 4} ${cy + 1} M${cx + 4} ${cy - 4} L${cx + 4} ${cy + 1}`} stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
    </>
  )
}

/** Head and two paws gripping an edge at y = 84. Nothing below the edge: the card hides the rest. */
function Peek({ c, striped, tuxedo }: PartProps) {
  const paw = c.belly === c.fur ? c.fur : c.belly
  return (
    <>
      <Head c={c} striped={striped} tuxedo={tuxedo} cy={52} lookUp />
      <Paw cx={38} cy={84} fill={paw} />
      <Paw cx={82} cy={84} fill={paw} />
    </>
  )
}

/** Sitting on an edge at y = 146, optionally waving. */
function Sitting({ c, striped, tuxedo, wave }: PartProps & { wave: boolean }) {
  const paw = c.belly === c.fur ? c.fur : c.belly
  return (
    <>
      <Limb d="M84 132 Q116 130 110 100 Q106 88 98 94" fur={c.fur} />
      <path d="M32 140 Q24 98 44 82 L76 82 Q96 98 88 140 Q60 147 32 140 Z" fill={c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <ellipse cx="60" cy="118" rx="14" ry="18" fill={c.belly} />
      {c.patch ? <path d="M70 92 Q86 96 86 118 Q78 112 70 112 Z" fill={c.patch} /> : null}
      <Paw cx={47} cy={140} fill={paw} />
      {wave ? (
        <>
          <Limb d="M80 92 Q98 84 100 64" fur={c.fur} />
          <ellipse cx="100" cy="60" rx="8" ry="8" fill={paw} stroke={INK} strokeWidth="3" />
        </>
      ) : (
        <Paw cx={73} cy={140} fill={paw} />
      )}
      <Head c={c} striped={striped} tuxedo={tuxedo} cy={58} />
    </>
  )
}

/** Napping loaf on an edge at y = 70, tail hanging down over it, eyes shut. */
function Nap({ c, striped }: PartProps) {
  const paw = c.belly === c.fur ? c.fur : c.belly
  return (
    <>
      <Limb d="M126 62 Q144 66 140 86 Q137 98 143 104" fur={c.fur} />
      <path d="M30 70 Q26 34 72 32 L112 32 Q138 36 134 70 Z" fill={c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      {c.patch ? <path d="M92 34 Q122 34 128 60 Q108 54 94 50 Z" fill={c.patch} /> : null}
      {striped ? <path d="M84 36 L82 48 M96 35 L95 48 M108 36 L108 48" stroke={c.dark} strokeWidth="3.5" strokeLinecap="round" /> : null}
      <path d="M20 30 L22 4 L42 22 Z" fill={c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M25 24 L26 12 L35 21 Z" fill={PINK} />
      <path d="M68 30 L66 4 L48 22 Z" fill={c.patch ?? c.fur} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M63 24 L62 12 L54 21 Z" fill={PINK} />
      <ellipse cx="44" cy="42" rx="30" ry="23" fill={c.fur} stroke={INK} strokeWidth="3.5" />
      <path d="M30 42 Q35 47 40 42 M48 42 Q53 47 58 42" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 50 L48 50 L44 54 Z" fill={PINK} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M22 50 L6 47 M22 54 L6 56 M66 50 L82 47 M66 54 L82 56" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <Paw cx={34} cy={68} fill={paw} />
      <Paw cx={56} cy={68} fill={paw} />
      <path d="M78 10 L86 10 L78 18 L86 18 M92 2 L98 2 L92 8 L98 8" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}
