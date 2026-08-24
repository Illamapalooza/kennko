/**
 * Local photography we actually hold, mapped to the drinks it genuinely shows.
 * Deliberately conservative: a wrong photo is worse than an honest placeholder,
 * so a drink only appears here when the shot is unambiguously of it.
 *
 * An image uploaded through the admin always wins over this map.
 */
export const LOCAL_DRINK_PHOTOS: Record<string, string> = {
  'Egg Coffee': '/brand/egg-coffee.jpg',
  'Sea Salt Caramel Oat': '/brand/sea-salt-caramel-oat-latte.jpg',
  'Vanilla Milk': '/brand/vanilla-milk-cloud-foam-kennko.jpg',
  'Coconut Coffee': '/brand/coconut-series.jpg',
}

export function drinkPhoto(name: string, uploadedUrl: string | null): string | null {
  return uploadedUrl ?? LOCAL_DRINK_PHOTOS[name] ?? null
}
