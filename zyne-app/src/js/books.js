// ─────────────────────────────────────────────────────────────
//  BOOKS — turn book-summary articles into single-idea cards.
//
//  No AI and no typing: the summary sites publish full articles in
//  their RSS with a consistent shape, so the ideas can be lifted
//  out by pattern alone.
//
//  Four Minute Books gives, per book:
//    "1-Sentence-Summary:"            → the hook
//    "Favorite quote from the author" → a quote
//    "Lesson 1/2/3:"                  → three ideas
//  Bullet-style sources (Sivers, Blas Moros) fall back to their
//  list items. Anything unparseable degrades to one summary card
//  rather than disappearing.
// ─────────────────────────────────────────────────────────────

const MIN_IDEA = 90     // shorter than this is a fragment, not an idea
const MAX_IDEA = 900    // longer than this is an essay, not a card

// Book feeds also carry podcast episodes and essays. Only entries that name a
// book — "<Title> Summary" or "<Title> by <Author>" — become idea cards, so a
// mixed feed contributes its book posts and nothing else.
export function looksLikeBook(rawTitle) {
  const t = (rawTitle || '').trim()
  if (!t) return false
  if (/\bsummary\s*$/i.test(t)) return true
  if (/^summary of\s+/i.test(t)) return true
  return /\sby\s+[A-Z][\w.'-]+(\s+[A-Z][\w.'-]+)*\s*$/.test(t)
}

// "Wa — The Art of Balance Summary" → "Wa — The Art of Balance"
// "Who Knew by Barry Driller"       → {title, author}
export function bookFromTitle(raw) {
  let t = (raw || '').trim()
    .replace(/\s*[-–—|]?\s*(book\s+)?summary\s*$/i, '')
    .replace(/^summary of\s+/i, '')
    .replace(/\s*\(review\)\s*$/i, '')
    .trim()
  const by = /^(.*?)\s+by\s+([^,]+?)\s*$/i.exec(t)
  return by ? { title: by[1].trim(), author: by[2].trim() } : { title: t, author: '' }
}

// Inline tags become a space and block tags a newline — collapsing both to
// newlines shreds sentences at every link and italic, which then surface as
// cards that begin mid-clause.
const INLINE = /<\/?(?:a|em|strong|b|i|span|code|sup|sub|u|mark|small|abbr|cite|q)\b[^>]*>/gi

const clean = s => (s || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(INLINE, ' ')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&#8217;|&#039;|&apos;/g, '’')
  .replace(/&#8220;|&#8221;|&quot;/g, '"')
  .replace(/&#8212;|&mdash;/g, '—')
  .replace(/&#8211;|&ndash;/g, '–')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{2,}/g, '\n')
  .trim()

const tidy = s => (s || '').replace(/\s+/g, ' ').trim()

// Boilerplate the summary sites repeat on every post.
const JUNK = /(download the free pdf|download pdf|read in:|if you want to save this summary|affiliate|subscribe|newsletter|share this|posted (on|in)|read more|click here|table of contents)/i

function usable(text) {
  const t = tidy(text)
  if (t.length < MIN_IDEA || t.length > MAX_IDEA || JUNK.test(t)) return false
  // must read as a whole thought, not a fragment sliced out of one
  return /^["“'(A-Z0-9]/.test(t) && /[.!?"”']$/.test(t)
}

// Pull the "Lesson N: ..." blocks and the paragraphs beneath each.
function lessonBlocks(text) {
  const out = []
  const re = /^Lesson\s+(\d+)\s*:\s*(.+)$/gim
  const marks = []
  let m
  while ((m = re.exec(text)) !== null) marks.push({ i: m.index, len: m[0].length, n: m[1], head: m[2].trim() })
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].i + marks[k].len
    const end = k + 1 < marks.length ? marks[k + 1].i : Math.min(text.length, start + 2200)
    const body = text.slice(start, end).split('\n').map(tidy).filter(l => l && !JUNK.test(l))
    // enough to be worth reading, capped so a card stays a card
    let acc = ''
    for (const line of body) {
      if ((acc + ' ' + line).length > MAX_IDEA) break
      acc = acc ? `${acc} ${line}` : line
    }
    if (tidy(acc).length >= MIN_IDEA) out.push({ head: marks[k].head, text: tidy(acc) })
    else if (marks[k].head.length >= 40) out.push({ head: '', text: marks[k].head })
  }
  return out
}

// Generic fallback: the longest standalone paragraphs.
function paragraphIdeas(text, limit) {
  return text.split('\n').map(tidy).filter(usable).slice(0, limit).map(t => ({ head: '', text: t }))
}

// Section labels are scaffolding for the parser, not part of the idea.
const stripLabel = s => (s || '')
  .replace(/^\s*(?:1-Sentence-Summary|Favorite quote(?:\s+from the author)?|Lesson\s*\d+)\s*:\s*/i, '')
  .trim()

// Text following a section marker, stopping at the next section. Inline tags
// now collapse to spaces, so a section can be one long line or several.
function afterMarker(text, markerRe, maxChars = 700) {
  const m = markerRe.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  let acc = ''
  for (const line of rest.split('\n').map(tidy).filter(Boolean)) {
    if (/^(?:Read in|Lesson\s*\d|Here are|1-Sentence-Summary|Favorite quote)/i.test(line)) break
    if (JUNK.test(line)) break
    if ((acc + ' ' + line).length > maxChars) break
    acc = acc ? `${acc} ${line}` : line
    if (acc.length >= MIN_IDEA && /[.!?"”']$/.test(acc)) break
  }
  return acc
}

/**
 * @param html  raw content:encoded (or description) for one article
 * @param meta  { rawTitle, url, source, thumb, published_at }
 * @returns idea cards, newest-book-first order preserved by the caller
 */
export function extractIdeas(html, meta = {}, max = 5) {
  const text = clean(html)
  const { title: book, author } = bookFromTitle(meta.rawTitle)
  const ideas = []

  const key = s => tidy(s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
  const push = (raw, label) => {
    if (ideas.length >= max) return
    const t = tidy(stripLabel(raw))
    if (!usable(t)) return
    if (ideas.some(i => key(i.text) === key(t))) return
    ideas.push({ text: t, label })
  }

  push(afterMarker(text, /1-Sentence-Summary:/i, 420), 'the pitch')
  push(afterMarker(text, /Favorite quote(?:\s+from the author)?:/i, 520), 'quote')

  for (const l of lessonBlocks(text)) push(l.head ? `${l.head} ${l.text}` : l.text, 'lesson')

  if (ideas.length < 2) for (const p of paragraphIdeas(text, max)) push(p.text, 'idea')

  return ideas.map((idea, i) => ({
    kind: 'idea',
    book,
    author,
    label: idea.label,
    text: idea.text,
    title: book,
    summary: idea.text,
    url: meta.url || '',
    source: meta.source || '',
    thumb: i === 0 ? (meta.thumb || '') : '',
    published_at: meta.published_at || new Date().toISOString(),
  }))
}
