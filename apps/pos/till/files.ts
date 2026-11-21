export type TillFiles = {
  read(name: string): string | null
  write(name: string, text: string, opts?: { secret?: boolean }): void
  remove(name: string): void
}
