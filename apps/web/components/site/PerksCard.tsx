import styles from './PerksCard.module.css'

export type PerksSlot = { stamped: boolean; date?: string | null }

/** One tilted takeaway cup, as printed on the paper perks card. Solid when stamped, an outline when not. */
function Cup({ filled }: { filled: boolean }) {
  return (
    <svg className={styles.cup} viewBox="0 0 24 36" aria-hidden="true">
      <path d="M13 2 L15 10" className={styles.straw} />
      <path
        d="M5 10 H19 L17 34 H7 Z"
        className={filled ? styles.cupOn : styles.cupOff}
      />
      <path d="M4 10 H20" className={filled ? styles.lidOn : styles.lidOff} />
    </svg>
  )
}

/**
 * The Kennko perks card, drawn like the printed one: KENNKO on top, PERKS CARD below, eight cups in two rows of four
 * and the free drink at the end of the second row. Used on the home page (a demo) and on the account page (the real
 * stamps). There is no free upsize: the card is eight stamps to a free drink.
 */
export function PerksCard({ slots, freeDrinkReady = false, label }: { slots: PerksSlot[]; freeDrinkReady?: boolean; label: string }) {
  const cups = slots.slice(0, 8)
  const cell = (s: PerksSlot, i: number) => (
    <li key={i} className={styles.slot}>
      <Cup filled={s.stamped} />
      {s.date ? <span className={styles.date}>{s.date}</span> : null}
    </li>
  )
  return (
    <figure className={styles.card} aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.wordmark} src="/brand/wordmark-white.png" alt="Kennko" width={536} height={163} />
      <ol className={styles.grid}>
        {cups.slice(0, 4).map(cell)}
        <li className={styles.spacer} aria-hidden="true" />
        {cups.slice(4, 8).map((s, i) => cell(s, i + 4))}
        <li className={freeDrinkReady ? `${styles.slot} ${styles.reward} ${styles.rewardReady}` : `${styles.slot} ${styles.reward}`}>
          <Cup filled={freeDrinkReady} />
          <span className={styles.rewardText}>Free drink</span>
        </li>
      </ol>
      <figcaption className={styles.caption}>Perks card</figcaption>
    </figure>
  )
}
