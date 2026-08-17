// ─────────────────────────────────────────────────────────────
//  RANKER — one batched Claude Haiku 4.5 call per refresh.
//  Scores fetched items 0-10 against the user's interest
//  profile and writes a one-line hook for the good ones.
//  Raw HTTP (no SDK): the app fetches through Tauri plugin-http
//  in production and directly (with the CORS opt-in header) in
//  browser dev. Costs ~1-3¢ per refresh.
// ─────────────────────────────────────────────────────────────

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
let tauriFetchP = null

// The user's calibrated taste (2026-07-27 session). Editable in Settings.
export const DEFAULT_PROFILE = `CORE INTERESTS (score high):
- AI industry: model releases, agent incidents, lab strategy, real adoption stories
- China tech: chips, markets, how technology is actually used in China
- Macro economics: central banks, rates, inflation, trade policy and its effect on real companies
- Business & product strategy: how companies and products win or lose
- Software engineering: practical tools, architecture, notable open source
- Design craft: UX, product design
- Crypto EDUCATION only: how protocols and mechanisms work
- Geopolitics with global stakes, explained with background
- Books and learning: practical takeaways

BOOST: stories anchored on striking numbers · deep explainers · breaking events of global significance

SCORE 0-2 (noise):
- Crime, shootings, local incidents
- Celebrity, sports, entertainment, lifestyle
- Human-interest profiles and narrative features
- Coin price predictions, "buy this token", trading signals
- Clickbait, listicles, outrage bait`

// ─── LOCAL SCORING (no API, no cost) ─────────────────────────
// Keyword scoring straight from the interest profile: everything above the
// "SCORE 0-2" marker counts as signal, everything below as noise. Cruder
// than Haiku — no hooks, no reading between the lines — but free and offline.
// ponytail: single words only; phrase matching if this proves too blunt.
const STOP = new Set(('the and for are but not all any can how its out use used using with that their this from when what only also into they them than then over more most some such very will your you about which been were has have score high boost items item line max words plain real sentence user profile interest interests content stories things').split(' '))

function profileWords(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9+.\-]{3,}/g) || [])
    .filter(w => !STOP.has(w))
    // crude de-pluralise so "shootings" in the profile matches "shooting" in a
    // headline; guarded at 5 chars so "news" doesn't decay into "new"
    .map(w => (w.endsWith('s') && w.length > 5 ? w.slice(0, -1) : w)))]
}

function parseProfile(profile) {
  const split = profile.split(/score\s*0-2|noise\s*\)?:/i)
  return {
    good: profileWords(split[0] || ''),
    bad: profileWords(split.slice(1).join(' ')),
  }
}

// Returns [{id, score, hook}] with hook null — leaves items eligible for a
// real Haiku pass later, once credits are back.
export function scoreLocally(items, profile) {
  const { good, bad } = parseProfile(profile)
  return items.map(it => {
    const text = `${it.title} ${it.summary} ${it.source}`.toLowerCase()
    let s = 5
    for (const w of good) if (text.includes(w)) s += 1.2
    for (const w of bad) if (text.includes(w)) s -= 2.5
    if (it.kind === 'repo') s += 1        // starred repos are already filtered
    return { id: it.id, score: Math.max(1, Math.min(10, Math.round(s))), hook: null }
  })
}

const SYSTEM = `You score content items for a personal feed reader. For each item, give:
- "s": 0-10 relevance to the user's interest profile (10 = must-read, 0 = pure noise)
- "h": if s >= 6, one plain sentence (max 15 words) on why it's worth their time — specific, no hype. If s < 6, empty string.
Score every item you are given, keyed by its "id".`

const SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          s: { type: 'integer' },
          h: { type: 'string' },
        },
        required: ['id', 's', 'h'],
        additionalProperties: false,
      },
    },
  },
  required: ['scores'],
  additionalProperties: false,
}

// Returns [{id, score, hook}] for up to 150 items; throws on API failure.
export async function rankItems(items, profile, apiKey) {
  const batch = items.slice(0, 150).map(it => ({
    id: it.id,
    source: it.source,
    kind: it.kind,
    title: (it.title || '').slice(0, 140),
    summary: (it.summary || '').slice(0, 100),
  }))
  if (!batch.length) return []

  let f = fetch
  if (IS_TAURI) {
    if (!tauriFetchP) tauriFetchP = import('@tauri-apps/plugin-http').then(m => m.fetch)
    f = await tauriFetchP
  }

  const res = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: `INTEREST PROFILE:\n${profile}\n\nITEMS:\n${JSON.stringify(batch)}`,
      }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new Error('ranking refused')
  const text = data.content?.find(b => b.type === 'text')?.text || '{}'
  const parsed = JSON.parse(text)
  return (parsed.scores || []).map(r => ({
    id: String(r.id),
    score: Math.max(0, Math.min(10, Number(r.s) || 0)),
    hook: String(r.h || '').slice(0, 160),
  }))
}
