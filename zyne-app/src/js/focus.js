// ─────────────────────────────────────────────────────────────
//  FOCUS — Pomodoro state machine + focus-sound sources.
//
//  Sound playback uses the official YouTube IFrame embed and keeps
//  the player visible at ≥200×200. YouTube's API policy forbids
//  hiding or overlaying the player, so there is deliberately no
//  "audio only" mode:
//  https://developers.google.com/youtube/terms/required-minimum-functionality
// ─────────────────────────────────────────────────────────────

// Rhythms, not doctrine. The 52/17 figures come from DeskTime observing their
// own most-productive users (2014, repeated 2021 and 2024) — usage data, not a
// controlled trial. The 90-minute block follows Kleitman's ultradian cycle.
// The exact numbers matter less than matching the rhythm to the task.
export const METHODS = [
  { key: 'pomodoro', name: 'Pomodoro', rhythm: '25 / 5', focus: 25, short: 5, long: 15, rounds: 4,
    benefit: 'Starting when you don’t want to — the exit is always close.' },
  { key: 'fiftytwo', name: '52 / 17', rhythm: '52 / 17', focus: 52, short: 17, long: 25, rounds: 3,
    benefit: 'Work you’re already into. Cuts out before attention drops.' },
  { key: 'deep', name: 'Deep block', rhythm: '90 / 20', focus: 90, short: 20, long: 30, rounds: 2,
    benefit: 'Hard problems that need a long runway before they open up.' },
  { key: 'flowtime', name: 'Flowtime', rhythm: 'counts up', focus: 0, short: 5, long: 10, rounds: 4,
    benefit: 'No alarm. Stop when you actually break, not when a bell says so.' },
]

export const methodByKey = k => METHODS.find(m => m.key === k) || METHODS[0]
export const isCountUp = cfg => !cfg || !cfg.focus

export const DEFAULT_DURATIONS = METHODS[0]

// Pure transition — unit-testable, no timers involved.
// Returns the phase that follows `phase` given completed focus rounds.
export function nextPhase(phase, roundsDone, cfg = DEFAULT_DURATIONS) {
  if (phase === 'focus') {
    return (roundsDone + 1) % cfg.rounds === 0
      ? { phase: 'long', roundsDone: roundsDone + 1 }
      : { phase: 'short', roundsDone: roundsDone + 1 }
  }
  return { phase: 'focus', roundsDone }
}

export const phaseLabel = p => (p === 'focus' ? 'FOCUS' : p === 'short' ? 'SHORT BREAK' : 'LONG BREAK')
export const phaseMinutes = (p, cfg) => (p === 'focus' ? cfg.focus : p === 'short' ? cfg.short : cfg.long)

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ─── sound sources ───────────────────────────────────────────
// Accepts the URL shapes people actually paste.
export function youtubeId(url) {
  const s = (url || '').trim()
  const m =
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/.exec(s) ||
    /^([A-Za-z0-9_-]{11})$/.exec(s)
  return m ? m[1] : null
}

/**
 * Sounds carry a role, because background music and a guided breathing
 * session want opposite treatment:
 *   loop  <url> | Label            → plays under the work, repeats
 *   break <url> | Label | minutes  → played once during a break
 * A line with no role is background, so older lists keep working.
 */
export function parseSounds(text) {
  return (text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(line => {
      const parts = line.split('|').map(s => s.trim())
      const role = /^(loop|break)\b/i.exec(parts[0])
      const spec = role ? parts[0].slice(role[0].length).trim() : parts[0]
      const id = youtubeId(spec)
      if (!id) return null
      const kind = role ? role[1].toLowerCase() : 'loop'
      return {
        role: kind,
        id,
        name: parts[1] || (kind === 'break' ? 'Break session' : 'Focus sound'),
        minutes: parseInt(parts[2]) || 0,     // 0 = unknown length, fits any break
      }
    })
    .filter(Boolean)
}

// Only offer what actually fits — no starting a 10-minute exercise
// with four minutes of break left.
export const breakSoundsFor = (sounds, breakMinutes) =>
  sounds.filter(s => s.role === 'break' && (!s.minutes || s.minutes <= breakMinutes))

export const DEFAULT_SOUNDS = `# One per line:   loop|break  <youtube link>  | Label  | minutes
#
#   loop  — background. Starts with your session and repeats.
#   break — a guided session. Offered when the break is long enough,
#           and plays once. The last number is its length in minutes.
#
# loop  <youtube link> | Lofi radio
# loop  <youtube link> | Justin Sung focus music
# break <youtube link> | Wim Hof breathing | 10
# break <youtube link> | Box breathing     | 5
`
