// Run order of the changes in one worktree. A number set by hand (`order:` in .openspec.yaml)
// wins; every other change comes after the changes its proposal says it depends on.

const BACKTICKED = /`([^`\s]+)`/g

/** Change names in backticks on a "Depends on" line or in a "## Dependency" section. Only other listed changes. */
export function dependsOn(proposal: string | null, names: string[], self: string): string[] {
  if (!proposal) {
    return []
  }
  const sources: string[] = []
  let inSection = false
  for (const line of proposal.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = /^#{1,6}\s+dependenc(y|ies)\b/i.test(line)
    } else if (inSection || /depends on/i.test(line)) {
      sources.push(line)
    }
  }
  const found = sources.flatMap((line) => [...line.matchAll(BACKTICKED)].map((match) => match[1]))
  return [...new Set(found)].filter((name) => name !== self && names.includes(name))
}

export interface OrderInput {
  name: string
  /** `created:` from .openspec.yaml; '' when missing. */
  created: string
  /** Number set by hand, or null. */
  pinned: number | null
  deps: string[]
}

const byAge = (a: OrderInput, b: OrderInput): number => a.created.localeCompare(b.created) || a.name.localeCompare(b.name)

/** Number of each change. Hand-set numbers stay as set; the others take the free numbers in dependency order. */
export function numberChanges(changes: OrderInput[]): Map<string, number> {
  const result = new Map<string, number>()
  const taken = new Set<number>()
  for (const change of changes) {
    if (change.pinned !== null) {
      result.set(change.name, change.pinned)
      taken.add(change.pinned)
    }
  }
  // Dependency order: take the oldest change whose dependencies are all placed. A loop falls back to age.
  const waiting = changes.filter((change) => change.pinned === null).sort(byAge)
  const placed = new Set(changes.filter((change) => change.pinned !== null).map((change) => change.name))
  const known = new Set(waiting.map((change) => change.name))
  let next = 1
  while (waiting.length > 0) {
    const ready = waiting.findIndex((change) => change.deps.every((dep) => placed.has(dep) || !known.has(dep)))
    const [change] = waiting.splice(ready === -1 ? 0 : ready, 1)
    while (taken.has(next)) {
      next += 1
    }
    result.set(change.name, next)
    taken.add(next)
    placed.add(change.name)
  }
  return result
}

const ORDER_LINE = /^order:\s*(\d+)\s*$/m

export function readOrder(yaml: string | null): number | null {
  const match = yaml ? ORDER_LINE.exec(yaml) : null
  return match ? Number(match[1]) : null
}

export function readCreated(yaml: string | null): string {
  return (yaml && /^created:\s*(\S+)/m.exec(yaml)?.[1]) || ''
}

/** .openspec.yaml with its `order:` line set to `order`, or removed when null. Other lines stay as they are. */
export function writeOrder(yaml: string | null, order: number | null): string {
  const lines = (yaml ?? '').split('\n').filter((line) => !/^order:/.test(line))
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  if (order !== null) {
    lines.push(`order: ${order}`)
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
