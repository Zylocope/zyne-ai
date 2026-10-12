// ─────────────────────────────────────────────────────────────
//  COACH — "what next?" suggestions and gentle nudges (pure, tested).
//  Builds a short plain-text picture of your day from what Zyne already
//  has (journal, events, focus logs, reading list), so there is nothing
//  to fill in. The text goes to Gemini only when AI is on; Rust holds
//  the key and the instructions.
//  House rules: no counts of what's left undone, no streaks, no guilt.
// ─────────────────────────────────────────────────────────────

const FOCUS_RE = /^Focused (\d+)m on (.+)$/

// days: [{iso, entries:[{type,state,text}]}], newest first, today included.
// events: today's schedule items [{name,time_start,duration_minutes}]
export function buildContext({ now, days = [], events = [], reading = [], about = '', skipped = [] }) {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' })
  const today = days[0]?.entries || []
  const open = today.filter(e => e.type === 'task' && e.state === 'open').map(e => e.text)
  const done = today.filter(e => e.type === 'task' && e.state === 'done').map(e => e.text)
  const focusToday = today.map(e => e.type === 'note' && FOCUS_RE.exec(e.text)).filter(Boolean)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const later = events
    .filter(ev => ev.time_start && toMin(ev.time_start) + (ev.duration_minutes || 0) > nowMin)
    .sort((a, b) => toMin(a.time_start) - toMin(b.time_start))
    .map(ev => `${ev.time_start} ${ev.name} (${ev.duration_minutes || 30}m)`)

  const lines = [`Now: ${dayName} ${hhmm}`]
  if (about.trim()) lines.push(`What matters to me lately: ${clip(about, 300)}`)
  lines.push(`Open tasks today: ${list(open)}`)
  if (done.length) lines.push(`Done today: ${list(done)}`)
  if (focusToday.length) lines.push(`Focus today: ${focusToday.map(m => `${m[1]}m ${m[2]}`).join('; ')}`)
  lines.push(`Events still ahead today: ${list(later)}`)
  const pattern = focusPattern(days)
  if (pattern) lines.push(`My recent focus habits: ${pattern}`)
  const recent = recentThemes(days.slice(1))
  if (recent) lines.push(`Recent days: ${recent}`)
  const books = reading.filter(b => !b.done).slice(0, 5).map(b => b.title)
  if (books.length) lines.push(`On my reading list: ${list(books)}`)
  if (skipped.length) lines.push(`Not now (already declined today): ${list(skipped)}`)
  return clip(lines.join('\n'), 6000)
}

// Which part of the day focus usually happens in, and typical length.
export function focusPattern(days) {
  const sessions = []
  for (const d of days) for (const e of d.entries || []) {
    const m = e.type === 'note' && FOCUS_RE.exec(e.text)
    if (m) sessions.push(+m[1])
  }
  if (sessions.length < 2) return ''
  const sorted = [...sessions].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return `usual session about ${median} min`
}

// A few done tasks from earlier days, so suggestions match real life.
export function recentThemes(days) {
  const done = []
  for (const d of days) for (const e of d.entries || []) {
    if (e.type === 'task' && e.state === 'done') done.push(e.text)
  }
  return done.length ? `finished ${list(done.slice(0, 8))}` : ''
}

// Gemini answers in JSON; anything malformed becomes null, never a crash.
export function parseSuggestion(text) {
  let v
  try { v = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { return null }
  if (!v || typeof v.next !== 'string' || !v.next.trim()) return null
  const minutes = Math.round(Number(v.minutes))
  return {
    next: clip(v.next.trim(), 80),
    why: clip(String(v.why || '').trim(), 160),
    firstStep: clip(String(v.first_step || '').trim(), 120),
    minutes: Number.isFinite(minutes) ? Math.min(90, Math.max(5, minutes)) : 25,
    also: (Array.isArray(v.also) ? v.also : []).filter(a => typeof a === 'string' && a.trim())
      .slice(0, 2).map(a => clip(a.trim(), 90)),
  }
}

// Nudge times. Returns the slot to fire now, or null.
// lastKey is "<iso>|<slot>" of the last nudge sent.
export const NUDGE_SLOTS = ['09:30', '13:30', '17:00', '20:30']
export function dueNudge(now, lastKey, slots = NUDGE_SLOTS) {
  const iso = isoDate(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // latest slot already reached, but only within 20 min of it (app may open late)
  const slot = [...slots].reverse().find(s => nowMin >= toMin(s) && nowMin < toMin(s) + 20)
  if (!slot) return null
  const key = `${iso}|${slot}`
  return key === lastKey ? null : key
}

// ─── helpers ─────────────────────────────────────────────────
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
const list = a => a.length ? a.map(s => clip(s, 80)).join('; ') : 'none'
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ─────────────────────────────────────────────────────────────
//  DAILY LENS — the card as a prompt for three kinds of intelligence
//  plus one if–then plan (implementation intention: "if <cue>, then
//  <tiny action>"), which keeps people consistent without streaks.
//    mind   — thinking well (IQ side): break down, reframe, test
//    heart  — handling feelings (EQ side): name it, regulate, be kind
//    people — social intelligence: connect, ask, listen, thank
//  Gemini personalises it from the day; LOCAL_LENS works offline.
// ─────────────────────────────────────────────────────────────

// One per suit, written for this app. Plain principles, no diagnosis.
export const LOCAL_LENS = {
  major: {
    mind: 'Ask what kind of person would do today’s hardest task, then do the first minute of it as that person.',
    heart: 'Big days stir big feelings. Name the strongest one in a single word; naming it lowers its volume.',
    people: 'Tell one person what you are working toward. Saying it out loud makes it more real.',
    ifThen: 'If I sit down at my desk, then I open the one thing that matters before anything else.',
  },
  wands: {
    mind: 'Shrink the task until starting feels almost silly: one sentence, one file, one problem.',
    heart: 'Restlessness is energy without a direction. Give it one target for 25 minutes.',
    people: 'Share a rough draft with someone early. Feedback on a sketch is cheaper than on a finished piece.',
    ifThen: 'If I feel the urge to scroll, then I do two minutes of my task first.',
  },
  cups: {
    mind: 'Before deciding, ask: what would I tell a friend in this exact spot?',
    heart: 'Check in with your body: tired, hungry, or tense? Fix that first; focus follows.',
    people: 'Send one short, specific thank-you today. Gratitude strengthens the relationships that carry you.',
    ifThen: 'If I notice I am being hard on myself, then I say what I would say to a friend.',
  },
  swords: {
    mind: 'Write the problem as one question. Then list two possible answers before choosing.',
    heart: 'When a thought hurts, ask: is it true, or just loud? Thoughts are guesses, not facts.',
    people: 'In one conversation today, listen to understand, not to reply. Repeat back what you heard.',
    ifThen: 'If I get stuck for 10 minutes, then I write down exactly where I am stuck and ask someone.',
  },
  pentacles: {
    mind: 'Progress is built from boring repeats. Pick the smallest version you could do every day.',
    heart: 'Notice one thing that went fine today. Seeing progress keeps motivation steady.',
    people: 'Help someone with something small you are good at. Teaching sharpens what you know.',
    ifThen: 'If I finish lunch, then I spend 15 minutes on my main project before anything else.',
  },
}

export function localLens(card) {
  const l = LOCAL_LENS[card?.suit] || LOCAL_LENS.major
  return { ...l, source: 'local' }
}

export function buildLensContext(card, dayContext) {
  return clip(`Today's card: ${card.name} (${card.suit}) — ${card.keys}. Image: ${card.image}\n${dayContext}`, 7000)
}

export function parseLens(text) {
  let v
  try { v = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { return null }
  const f = k => clip(String(v?.[k] || '').trim(), 220)
  const out = { mind: f('mind'), heart: f('heart'), people: f('people'), ifThen: f('if_then'), source: 'ai' }
  return out.mind && out.heart && out.people && out.ifThen ? out : null
}
