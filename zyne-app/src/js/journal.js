// ─────────────────────────────────────────────────────────────
//  JOURNAL — bullet-journal daily logs as markdown files:
//  Documents/ZyneVault/journal/YYYY-MM-DD.md  (Obsidian daily-
//  note compatible). Line format follows Obsidian Tasks states:
//    - [ ] task (open)     - [x] task (done)
//    - [>] task (migrated) - [-] task (skipped)
//    - note (plain bullet)
//  Timed events live in SQLite (schedule engine + reminders),
//  not here. Browser dev falls back to localStorage.
// ─────────────────────────────────────────────────────────────

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
const VAULT = 'ZyneVault'

let fsP = null
async function fs() {
  if (!fsP) fsP = import('@tauri-apps/plugin-fs')
  return fsP
}

async function ensureDir(sub) {
  const m = await fs()
  const dir = `${VAULT}/${sub}`
  if (!(await m.exists(dir, { baseDir: m.BaseDirectory.Document }))) {
    await m.mkdir(dir, { baseDir: m.BaseDirectory.Document, recursive: true })
  }
}

const dayPath = iso => `${VAULT}/journal/${iso}.md`

async function readDayFile(iso) {
  if (!IS_TAURI) return localStorage.getItem('zyne_journal_' + iso) || ''
  const m = await fs()
  await ensureDir('journal')
  if (!(await m.exists(dayPath(iso), { baseDir: m.BaseDirectory.Document }))) return ''
  return m.readTextFile(dayPath(iso), { baseDir: m.BaseDirectory.Document })
}

async function writeDayFile(iso, text) {
  if (!IS_TAURI) { localStorage.setItem('zyne_journal_' + iso, text); return }
  const m = await fs()
  await ensureDir('journal')
  await m.writeTextFile(dayPath(iso), text, { baseDir: m.BaseDirectory.Document })
}

const TASK_RE = /^- \[([ x>-])\] (.*)$/
const NOTE_RE = /^- (?!\[)(.*)$/
const STATE = { ' ': 'open', 'x': 'done', '>': 'migrated', '-': 'skipped' }
const MARK = { open: ' ', done: 'x', migrated: '>', skipped: '-' }

// Returns [{type:'task'|'note', state, text, lineIdx}]
export async function loadDay(iso) {
  const lines = (await readDayFile(iso)).split('\n')
  const entries = []
  lines.forEach((l, i) => {
    const t = l.match(TASK_RE)
    if (t) { entries.push({ type: 'task', state: STATE[t[1]], text: t[2], lineIdx: i }); return }
    const n = l.match(NOTE_RE)
    if (n && n[1].trim()) entries.push({ type: 'note', state: 'note', text: n[1], lineIdx: i })
  })
  return entries
}

export async function addEntry(iso, type, text) {
  const raw = await readDayFile(iso)
  const line = type === 'task' ? `- [ ] ${text}` : `- ${text}`
  await writeDayFile(iso, raw ? `${raw.replace(/\n$/, '')}\n${line}\n` : `${line}\n`)
}

// Set a task's state. 'migrated' also copies the task into nextIso's file.
export async function setTaskState(iso, lineIdx, state, nextIso = null) {
  const lines = (await readDayFile(iso)).split('\n')
  const t = lines[lineIdx]?.match(TASK_RE)
  if (!t) return
  lines[lineIdx] = `- [${MARK[state]}] ${t[2]}`
  await writeDayFile(iso, lines.join('\n'))
  if (state === 'migrated' && nextIso) await addEntry(nextIso, 'task', t[2])
}

export async function deleteEntry(iso, lineIdx) {
  const lines = (await readDayFile(iso)).split('\n')
  if (!TASK_RE.test(lines[lineIdx] || '') && !NOTE_RE.test(lines[lineIdx] || '')) return
  lines.splice(lineIdx, 1)
  await writeDayFile(iso, lines.join('\n'))
}

// Clip a feed item to ZyneVault/clips/YYYY-MM-DD-slug.md
export async function clipItem(it) {
  const date = new Date().toISOString().slice(0, 10)
  const slug = it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'clip'
  const md = `---
source: ${it.source}
url: ${it.url}
clipped: ${date}
---

# ${it.title}

${it.summary || ''}

[Open original](${it.url})
`
  if (!IS_TAURI) { console.log('[clip]', md); return `clips/${date}-${slug}.md` }
  const m = await fs()
  await ensureDir('clips')
  const path = `${VAULT}/clips/${date}-${slug}.md`
  await m.writeTextFile(path, md, { baseDir: m.BaseDirectory.Document })
  return path
}
