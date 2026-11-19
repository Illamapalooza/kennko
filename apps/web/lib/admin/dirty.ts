/**
 * Unsaved admin edits, by id. AutoRefresh skips its `router.refresh()` while
 * anything is here, so a background refresh never lands mid-save or over
 * text someone is still typing. Module-level: one set per browser tab.
 */
const dirty = new Set<string>()

export function markDirty(id: string): void {
  dirty.add(id)
}

export function clearDirty(id: string): void {
  dirty.delete(id)
}

export function hasDirty(): boolean {
  return dirty.size > 0
}

/** Refresh only a visible page with no unsaved edits. */
export function shouldRefresh(visible: boolean, isDirty: boolean): boolean {
  return visible && !isDirty
}
