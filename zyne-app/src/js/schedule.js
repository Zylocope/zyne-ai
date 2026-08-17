// ─────────────────────────────────────────────────────────────
//  SCHEDULE HELPERS — recurrence expansion + date math
//  Pure logic, no DB. Works on rows returned from db.js getSchedule().
// ─────────────────────────────────────────────────────────────

// Format helpers
export const pad = (n) => String(n).padStart(2, '0')
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseISODate = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

// Compare date-only (YYYY-MM-DD), ignoring time
export function sameDay(aISO, bISO) {
  return aISO && bISO && aISO.slice(0, 10) === bISO.slice(0, 10)
}

// Convert JS Date.getDay() (Sun=0) → our scheme matches (Sun=0..Sat=6)
export function weekday(date) { return date.getDay() }

// ─────────────────────────────────────────────────────────────
//  Does a schedule item occur on `date`?
//  item.recurrence_rule:
//    'once'           → only on item.date
//    'daily'          → every day from item.date onwards
//    'weekdays'       → Mon-Fri from item.date onwards
//    'weekly:1,3,5'   → on listed weekday numbers (Sun=0, Sat=6)
// ─────────────────────────────────────────────────────────────
export function occursOn(item, date) {
  const dateISO = toISODate(date)
  const rule = (item.recurrence_rule || 'once').trim()
  const startISO = (item.date || item.created_at || '').slice(0, 10)

  // Item must have started on or before `date`
  if (startISO && dateISO < startISO) return false

  if (rule === 'once') {
    // Only occurs on its own date. If no date set, treat as "today" (legacy items).
    if (!startISO) return true
    return dateISO === startISO
  }

  if (rule === 'daily') return true

  if (rule === 'weekdays') {
    const wd = weekday(date)
    return wd >= 1 && wd <= 5
  }

  if (rule.startsWith('weekly:')) {
    const days = rule.slice(7).split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    return days.includes(weekday(date))
  }

  return false
}

// Return all instances of the given items that occur on `date`, sorted by time.
export function itemsForDate(items, date) {
  return items
    .filter(it => occursOn(it, date))
    .sort((a, b) => (a.time_start || '').localeCompare(b.time_start || ''))
}

// Build a month grid for the given date's month.
// Returns 6 rows × 7 days, each cell = { date: Date, inMonth: bool, iso: 'YYYY-MM-DD' }
export function buildMonthGrid(anchorDate) {
  const y = anchorDate.getFullYear()
  const m = anchorDate.getMonth()
  const first = new Date(y, m, 1)
  const startOffset = first.getDay()            // Sun=0..Sat=6
  const gridStart = new Date(y, m, 1 - startOffset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push({
      date: d,
      inMonth: d.getMonth() === m,
      iso: toISODate(d),
    })
  }
  return cells
}

// Minutes since midnight, for timeline positioning
export function minutesFromTime(hhmm) {
  if (!hhmm) return 9 * 60
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Convert minutes → HH:MM string
export function timeFromMinutes(mins) {
  const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${pad(h)}:${pad(m)}`
}

// Snap minutes to nearest `step` (e.g. 15-minute intervals)
export function snapMinutes(mins, step = 15) {
  return Math.round(mins / step) * step
}

// Human label for a recurrence rule
export function recurrenceLabel(rule) {
  if (!rule || rule === 'once') return 'One-time'
  if (rule === 'daily')    return 'Every day'
  if (rule === 'weekdays') return 'Weekdays'
  if (rule.startsWith('weekly:')) {
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const days = rule.slice(7).split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    if (days.length === 0) return 'Weekly'
    if (days.length === 7) return 'Every day'
    return days.map(n => names[n]).join(' · ')
  }
  return rule
}
