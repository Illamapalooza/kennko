import { CupSticker, type CupFlavour, type CupPlate } from '@/components/site/CupSticker'

const PLATES: CupPlate[] = ['yellow', 'pink', 'orange', 'sky']

/** Picks the drawn cup's colour from the drink's name, so a matcha looks green and a mocha dark. */
export function cupFlavourFor(name: string): CupFlavour {
  const n = name.toLowerCase()
  if (n.includes('strawberry')) return 'strawberry'
  if (n.includes('matcha')) return 'matcha'
  if (n.includes('choco') || n.includes('mocha')) return 'choco'
  if (n.includes('caramel') || n.includes('honey') || n.includes('vanilla') || n.includes('hojicha') || n.includes('vietnamese')) return 'caramel'
  return 'coffee'
}

/**
 * The drink's art when the owner hasn't uploaded a photo: the same drawn cup as the landing page,
 * on a plate whose colour is picked from the name, so the same drink always looks the same and a
 * grid of cards reads as varied.
 */
export function DrinkPlaceholder({ name }: { name: string }) {
  const seed = [...name].reduce((n, c) => n + c.charCodeAt(0), 0)
  return (
    <div className="drink-media drink-art" role="img" aria-label={name}>
      <CupSticker flavour={cupFlavourFor(name)} plate={PLATES[seed % PLATES.length]} />
    </div>
  )
}
