import Database from '@tauri-apps/plugin-sql'

let db = null

export async function getDb() {
  if (!db) {
    db = await Database.load('sqlite:zyne.db')
    await initSchema()
  }
  return db
}

async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      stack TEXT, client TEXT,
      last_done TEXT, next_task TEXT,
      open_questions TEXT, ais_used TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title TEXT NOT NULL,
      author TEXT,
      total_pages INTEGER,
      current_page INTEGER DEFAULT 0,
      status TEXT DEFAULT 'reading',
      key_insight TEXT, applied_to TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      time_start TEXT,                         -- HH:MM (local)
      duration_minutes INTEGER DEFAULT 30,
      category TEXT DEFAULT 'task',
      date TEXT,                               -- YYYY-MM-DD; null = recurring template
      recurrence_rule TEXT,                    -- 'once' | 'daily' | 'weekdays' | 'weekly:1,3,5' (weekday numbers 0-6, Sun=0)
      notify_minutes INTEGER DEFAULT 0,        -- minutes before to notify; 0 = no notification
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      activity_type TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      duration_minutes INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS thoughts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS thought_responses (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      thought_id TEXT NOT NULL,
      bot_key TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      content TEXT,
      is_silent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS feed_items (
      id TEXT PRIMARY KEY,
      source TEXT, kind TEXT, title TEXT, summary TEXT,
      url TEXT, thumb TEXT, published_at TEXT,
      score REAL DEFAULT 0, hook TEXT,
      seen INTEGER DEFAULT 0, saved INTEGER DEFAULT 0,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_started_at TEXT,
      theme TEXT,
      decisions TEXT,            -- JSON array
      open_questions TEXT,       -- JSON array
      mentioned_projects TEXT,   -- JSON array
      mood_signal TEXT,
      next_action TEXT,
      transcript TEXT,           -- raw session text for re-analysis later
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Safe migrations for older DBs that were created before these columns existed.
  await addColumnIfMissing('schedule_items', 'date',             'TEXT')
  await addColumnIfMissing('schedule_items', 'recurrence_rule',  'TEXT')
  await addColumnIfMissing('schedule_items', 'notify_minutes',   'INTEGER DEFAULT 0')
  await addColumnIfMissing('schedule_items', 'notes',            'TEXT')
}

async function addColumnIfMissing(table, col, decl) {
  try {
    const info = await db.select(`PRAGMA table_info(${table})`)
    const has = info?.some(r => r.name === col)
    if (!has) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
    }
  } catch (e) {
    // If PRAGMA fails or column exists, fall through
    console.warn(`migrate ${table}.${col}:`, e.message || e)
  }
}

// Projects
export async function getProjects() {
  const db = await getDb()
  return await db.select('SELECT * FROM projects ORDER BY created_at DESC')
}

export async function saveProject(data) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO projects (name, stack, client, last_done, next_task, open_questions, ais_used, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [data.name, data.stack, data.client, data.last_done, data.next_task, data.open_questions, data.ais_used, data.notes]
  )
}

export async function updateProject(id, field, value) {
  const db = await getDb()
  await db.execute(`UPDATE projects SET ${field} = $1 WHERE id = $2`, [value, id])
}

// Books
export async function getBooks() {
  const db = await getDb()
  return await db.select('SELECT * FROM books ORDER BY created_at DESC')
}

export async function saveBook(data) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO books (title, author, total_pages, current_page, key_insight, applied_to)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [data.title, data.author, data.total_pages || 0, data.current_page || 0, data.key_insight, data.applied_to]
  )
}

export async function updateBook(id, field, value) {
  const db = await getDb()
  await db.execute(`UPDATE books SET ${field} = $1 WHERE id = $2`, [value, id])
}

// Schedule
export async function getSchedule() {
  const db = await getDb()
  return await db.select('SELECT * FROM schedule_items ORDER BY time_start')
}

export async function saveScheduleItem(data) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO schedule_items
      (name, time_start, duration_minutes, category, date, recurrence_rule, notify_minutes, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      data.name,
      data.time_start || '09:00',
      data.duration_minutes || 30,
      data.category || 'task',
      data.date || null,                           // null for recurring templates
      data.recurrence_rule || 'once',
      data.notify_minutes || 0,
      data.notes || '',
    ]
  )
}

export async function updateScheduleItem(id, patch) {
  const db = await getDb()
  const fields = Object.keys(patch)
  if (!fields.length) return
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ')
  const values = fields.map(f => patch[f])
  values.push(id)
  await db.execute(
    `UPDATE schedule_items SET ${sets} WHERE id = $${values.length}`, values
  )
}

export async function deleteScheduleItem(id) {
  const db = await getDb()
  await db.execute('DELETE FROM schedule_items WHERE id = $1', [id])
}

// Activity logs
export async function startActivity(type) {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO activity_logs (activity_type, started_at) VALUES ($1, datetime('now'))`,
    [type]
  )
  return result.lastInsertId
}

export async function endActivity(id, durationMins) {
  const db = await getDb()
  await db.execute(
    `UPDATE activity_logs SET ended_at = datetime('now'), duration_minutes = $1 WHERE id = $2`,
    [durationMins, id]
  )
}

// Thoughts
export async function saveThought(content) {
  const db = await getDb()
  const result = await db.execute(
    `INSERT INTO thoughts (content) VALUES ($1)`, [content]
  )
  return result.lastInsertId
}

export async function saveResponses(thoughtId, responses) {
  const db = await getDb()
  for (const r of responses) {
    await db.execute(
      `INSERT INTO thought_responses (thought_id, bot_key, bot_name, content, is_silent)
       VALUES ($1,$2,$3,$4,$5)`,
      [thoughtId, r.key, r.name, r.content, r.isSilent ? 1 : 0]
    )
  }
}

export async function getThoughts() {
  const db = await getDb()
  const thoughts = await db.select('SELECT * FROM thoughts ORDER BY created_at ASC')
  for (const t of thoughts) {
    t.responses = await db.select(
      'SELECT * FROM thought_responses WHERE thought_id = $1', [t.id]
    )
  }
  return thoughts
}

// Insights (Think → Vault bridge)
export async function saveInsight(insight, transcript = '', sessionStartedAt = null) {
  const db = await getDb()
  await db.execute(
    `INSERT INTO insights (session_started_at, theme, decisions, open_questions,
       mentioned_projects, mood_signal, next_action, transcript)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      sessionStartedAt || new Date().toISOString(),
      insight.theme || '',
      JSON.stringify(insight.decisions || []),
      JSON.stringify(insight.open_questions || []),
      JSON.stringify(insight.mentioned_projects || []),
      insight.mood_signal || 'neutral',
      insight.next_action || '',
      transcript,
    ]
  )
}

export async function getInsights(limit = 30) {
  const db = await getDb()
  const rows = await db.select(
    `SELECT * FROM insights ORDER BY created_at DESC LIMIT $1`, [limit]
  )
  return rows.map(r => ({
    ...r,
    decisions: safeParse(r.decisions, []),
    open_questions: safeParse(r.open_questions, []),
    mentioned_projects: safeParse(r.mentioned_projects, []),
  }))
}

function safeParse(s, fallback) {
  try { return JSON.parse(s) } catch { return fallback }
}

// Feed items
// ponytail: in-memory fallback so the feed still renders in plain-browser
// dev where the Tauri SQL plugin is unavailable. Not persistent there.
const memFeed = new Map()

export async function upsertFeedItems(items) {
  let db = null
  try { db = await getDb() } catch {}
  for (const it of items) {
    if (!db) {
      if (!memFeed.has(it.id)) memFeed.set(it.id, { ...it, seen: 0, saved: 0, score: 0 })
      continue
    }
    await db.execute(
      `INSERT OR IGNORE INTO feed_items (id, source, kind, title, summary, url, thumb, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [it.id, it.source, it.kind, it.title, it.summary, it.url, it.thumb, it.published_at]
    )
  }
}

export async function getUnseenFeed(limit = 60) {
  try {
    const db = await getDb()
    return await db.select(
      `SELECT * FROM feed_items WHERE seen = 0
       ORDER BY score DESC, published_at DESC LIMIT $1`, [limit]
    )
  } catch {
    return [...memFeed.values()].filter(i => !i.seen)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, limit)
  }
}

// Unseen items the ranker hasn't scored yet (hook doubles as the marker)
export async function getUnscoredFeed(limit = 150) {
  try {
    const db = await getDb()
    return await db.select(
      `SELECT * FROM feed_items WHERE seen = 0 AND hook IS NULL
       ORDER BY published_at DESC LIMIT $1`, [limit]
    )
  } catch {
    return [...memFeed.values()].filter(i => !i.seen && i.hook == null).slice(0, limit)
  }
}

export async function applyFeedScores(scores) {
  try {
    const db = await getDb()
    for (const s of scores) {
      await db.execute('UPDATE feed_items SET score = $1, hook = $2 WHERE id = $3',
        [s.score, s.hook, s.id])
    }
  } catch {
    for (const s of scores) {
      const it = memFeed.get(s.id)
      if (it) { it.score = s.score; it.hook = s.hook }
    }
  }
}

export async function markFeedSeen(id) {
  try {
    const db = await getDb()
    await db.execute('UPDATE feed_items SET seen = 1 WHERE id = $1', [id])
  } catch {
    const it = memFeed.get(id)
    if (it) it.seen = 1
  }
}

export async function markAllFeedSeen() {
  try {
    const db = await getDb()
    await db.execute('UPDATE feed_items SET seen = 1 WHERE seen = 0')
  } catch {
    memFeed.forEach(it => { it.seen = 1 })
  }
}

// Settings
export async function getSetting(key) {
  try {
    const db = await getDb()
    const rows = await db.select('SELECT value FROM settings WHERE key = $1', [key])
    return rows[0]?.value || null
  } catch {
    return localStorage.getItem('zyne_setting_' + key)   // browser-dev fallback
  }
}

export async function setSetting(key, value) {
  try {
    const db = await getDb()
    await db.execute(
      `INSERT INTO settings (key, value) VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value = $2`,
      [key, value]
    )
  } catch {
    localStorage.setItem('zyne_setting_' + key, value)
  }
}