/**
 * The photo to show for a drink: only an image the owner uploaded through admin. The 2025 product
 * shots were retired with the sticker redesign; without an upload the drink gets its drawn cup
 * (DrinkPlaceholder).
 */
export function drinkPhoto(uploadedUrl: string | null): string | null {
  return uploadedUrl
}
