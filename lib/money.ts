export function formatPesos(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new Error('centavos must be an integer')
  }
  if (centavos < 0) {
    throw new Error('centavos must not be negative')
  }

  const pesos = centavos / 100
  const hasFraction = centavos % 100 !== 0

  return `₱${pesos.toLocaleString('en-PH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
