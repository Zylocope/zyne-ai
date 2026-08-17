// ─────────────────────────────────────────────────────────────
//  LIBRARY storage — deliberately almost nothing.
//
//  You never type book data. Saving a book records its name and
//  where the idea came from; saving an idea writes the idea. Both
//  land in the vault as markdown so Obsidian can read them.
//
//    ZyneVault/reading-list.md      - [ ] Title — url (added date)
//    ZyneVault/ideas/<date>-<slug>.md
// ─────────────────────────────────────────────────────────────

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
const VAULT = 'ZyneVault'
const LIST = `${VAULT}/reading-list.md`

let fsP = null
async function fs() {
  if (!fsP) fsP = import('@tauri-apps/plugin-fs')
  return fsP
}

async function ensureDir(sub = '') {
  const m = await fs()
  const dir = sub ? `${VAULT}/${sub}` : VAULT
  if (!(await m.exists(dir, { baseDir: m.BaseDirectory.Document }))) {
    await m.mkdir(dir, { baseDir: m.BaseDirectory.Document, recursive: true })
  }
}

export const slug = s =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note'

const today = () => new Date().toISOString().slice(0, 10)

// ─── parsing (pure) ──────────────────────────────────────────
const LINE = /^-\s+\[( |x)\]\s+(.+?)(?:\s+—\s+(\S*))?(?:\s+\(added\s+(\d{4}-\d{2}-\d{2})\))?\s*$/

export function parseList(md) {
  return (md || '').split('\n').map(l => LINE.exec(l.trim())).filter(Boolean).map(m => ({
    done: m[1] === 'x',
    title: m[2].trim(),
    url: (m[3] || '').trim(),
    added: m[4] || '',
  }))
}

export function serializeList(items) {
  return items.map(b =>
    `- [${b.done ? 'x' : ' '}] ${b.title}${b.url ? ` — ${b.url}` : ''}${b.added ? ` (added ${b.added})` : ''}`
  ).join('\n') + '\n'
}

export function daysSince(iso) {
  if (!iso) return null
  const d = Math.floor((Date.now() - Date.parse(`${iso}T00:00:00`)) / 86400000)
  return Number.isFinite(d) && d >= 0 ? d : null
}

// ─── reading list ────────────────────────────────────────────
let memList = ''

async function readList() {
  if (!IS_TAURI) return memList
  const m = await fs()
  await ensureDir()
  if (!(await m.exists(LIST, { baseDir: m.BaseDirectory.Document }))) return ''
  return m.readTextFile(LIST, { baseDir: m.BaseDirectory.Document })
}

async function writeList(text) {
  if (!IS_TAURI) { memList = text; return }
  const m = await fs()
  await ensureDir()
  await m.writeTextFile(LIST, text, { baseDir: m.BaseDirectory.Document })
}

export async function listWant() {
  return parseList(await readList())
}

// Returns false when the book was already on the list.
export async function addWant(title, url = '') {
  const items = parseList(await readList())
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (items.some(b => norm(b.title) === norm(title))) return false
  items.push({ done: false, title, url, added: today() })
  await writeList(serializeList(items))
  return true
}

export async function toggleWant(title) {
  const items = parseList(await readList())
  const it = items.find(b => b.title === title)
  if (!it) return
  it.done = !it.done
  await writeList(serializeList(items))
}

export async function removeWant(title) {
  await writeList(serializeList(parseList(await readList()).filter(b => b.title !== title)))
}

// ─── saved ideas ─────────────────────────────────────────────
export async function saveIdea(card) {
  const date = today()
  const md = `---
book: ${card.book || ''}
source: ${card.source || ''}
url: ${card.url || ''}
saved: ${date}
---

> ${(card.text || '').replace(/\n/g, '\n> ')}

— ${card.book || 'Unknown'}${card.author ? `, ${card.author}` : ''}
${card.url ? `\n[Full summary](${card.url})` : ''}
`
  const path = `${VAULT}/ideas/${date}-${slug(card.book || card.text.slice(0, 40))}.md`
  if (!IS_TAURI) { console.log('[idea]', md); return path }
  const m = await fs()
  await ensureDir('ideas')
  await m.writeTextFile(path, md, { baseDir: m.BaseDirectory.Document })
  return path
}

// ─── break nudges ────────────────────────────────────────────
// Books you saved and haven't started. No counts, no streaks, no
// backlog — just a reminder of a decision you already made.
export function buildNudges(want, n = 2) {
  const open = want.filter(b => !b.done)
  const pool = [...open]
  const out = []
  while (pool.length && out.length < n) {
    const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    const d = daysSince(b.added)
    out.push({
      title: b.title,
      url: b.url,
      note: d === null ? 'on your reading list'
        : d === 0 ? 'you saved this today'
        : d === 1 ? 'you saved this yesterday'
        : `you saved this ${d} days ago`,
    })
  }
  return out
}
