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

export async function deleteScheduleItem(id) {
  const db = await getDb()
  await db.execute('DELETE FROM schedule_items WHERE id = $1', [id])
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