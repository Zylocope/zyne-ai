// Self-check for the pure logic behind Focus, Library and book ideas.
// Run:  node src/js/focus-library.test.js
import assert from 'node:assert/strict'
import { nextPhase, youtubeId, parseSounds, fmtClock, METHODS, methodByKey, breakSoundsFor } from './focus.js'
import { parseList, serializeList, buildNudges, daysSince, slug } from './library.js'
import { extractIdeas, bookFromTitle } from './books.js'
import { CARDS, READINGS, parseDeck, parseLines } from './tarot.js'
import { chatWindow } from './companion-model.js'

// ── pomodoro: the long break lands only after the 4th focus round
const pom = methodByKey('pomodoro')
let phase = 'focus', rounds = 0
const seen = []
for (let i = 0; i < 8; i++) {
  const r = nextPhase(phase, rounds, pom)
  phase = r.phase; rounds = r.roundsDone
  seen.push(phase)
}
assert.deepEqual(seen, ['short','focus','short','focus','short','focus','long','focus'])
assert.equal(fmtClock(25 * 60), '25:00')
assert.equal(fmtClock(-5), '00:00')

// every method is usable and self-describing
assert.ok(METHODS.length >= 4)
for (const m of METHODS) {
  assert.ok(m.key && m.name && m.benefit, `method missing fields: ${m.key}`)
  if (m.key !== 'flowtime') assert.ok(m.focus > 0 && m.rounds >= 2, `bad rhythm: ${m.key}`)
}
assert.equal(methodByKey('flowtime').focus, 0, 'flowtime counts up, so it has no fixed length')
assert.equal(methodByKey('nope').key, 'pomodoro', 'unknown key falls back to pomodoro')

// ── youtube url shapes people actually paste
for (const u of [
  'https://www.youtube.com/watch?v=jfKfPfyJRdk',
  'https://youtu.be/jfKfPfyJRdk?si=abc',
  'https://www.youtube.com/embed/jfKfPfyJRdk',
  'https://www.youtube.com/watch?list=RD&v=jfKfPfyJRdk',
  'jfKfPfyJRdk',
]) assert.equal(youtubeId(u), 'jfKfPfyJRdk', `failed to parse: ${u}`)
assert.equal(youtubeId('https://example.com/nope'), null)
assert.deepEqual(parseSounds('https://youtu.be/jfKfPfyJRdk | Lofi\n# c\n\nbad'),
  [{ role: 'loop', id: 'jfKfPfyJRdk', name: 'Lofi', minutes: 0 }])

// ── reading list survives a write→read round trip
const items = [
  { done: false, title: 'Deep Work', url: 'https://x.test/dw', added: '2026-08-01' },
  { done: true,  title: 'Ikigai', url: '', added: '2026-08-10' },
]
const back = parseList(serializeList(items))
assert.equal(back.length, 2)
assert.equal(back[0].title, 'Deep Work')
assert.equal(back[0].url, 'https://x.test/dw')
assert.equal(back[0].added, '2026-08-01')
assert.equal(back[0].done, false)
assert.equal(back[1].done, true)
assert.equal(back[1].title, 'Ikigai')
assert.equal(parseList('garbage\n- not a task').length, 0)
assert.equal(slug('Wa — The Art of Balance'), 'wa-the-art-of-balance')
assert.equal(daysSince(''), null)

// ── nudges: only unread books, bounded, phrased without guilt
const nud = buildNudges(back, 2)
assert.equal(nud.length, 1, 'finished books must not be nudged')
assert.equal(nud[0].title, 'Deep Work')
assert.match(nud[0].note, /saved this/)
assert.equal(buildNudges([], 2).length, 0)

// ── book titles
assert.deepEqual(bookFromTitle('Wa — The Art of Balance Summary'), { title: 'Wa — The Art of Balance', author: '' })
assert.deepEqual(bookFromTitle('Who Knew by Barry Driller'), { title: 'Who Knew', author: 'Barry Driller' })

// ── idea extraction from a Four Minute Books shaped article
const article = `
<p>1-Sentence-Summary: <em>Deep Work</em> argues that the ability to focus without
distraction is becoming rare exactly as it becomes valuable, and shows how to train it.</p>
<p>Read in: 4 minutes</p>
<p>Favorite quote from the author:</p>
<p>"Clarity about what matters provides clarity about what does not."</p>
<p>Here are 3 lessons from the book:</p>
<p>Lesson 1: Shallow work feels productive but rarely is.</p>
<p>Answering email all day leaves you exhausted and no closer to anything that matters,
because none of it required real concentration to produce.</p>
<p>Lesson 2: Schedule your focus rather than hoping for it.</p>
<p>People who reliably do deep work put it in the calendar and defend that block,
instead of waiting for a stretch of free time that never arrives on its own.</p>
<p>Download the free PDF</p>
`
const ideas = extractIdeas(article, { rawTitle: 'Deep Work Summary', url: 'https://x.test/dw', source: 'Four Minute Books' })
assert.ok(ideas.length >= 3, `expected several ideas, got ${ideas.length}`)
assert.ok(ideas.every(i => i.book === 'Deep Work'), 'every card names its book')
assert.ok(ideas.every(i => i.kind === 'idea'))
assert.ok(ideas.every(i => /^["“'(A-Z0-9]/.test(i.text)), 'no card may start mid-sentence')
assert.ok(ideas.every(i => !/^(Lesson\s*\d|1-Sentence|Favorite quote)/i.test(i.text)), 'section labels must be stripped')
assert.ok(ideas.every(i => !/download the free pdf/i.test(i.text)), 'boilerplate must be dropped')
assert.ok(ideas.some(i => i.label === 'the pitch'))
assert.ok(ideas.some(i => i.label === 'lesson'))
assert.equal(new Set(ideas.map(i => i.text)).size, ideas.length, 'no duplicate cards')

// an article with no recognisable structure still yields something usable
const plain = `<p>${'This is a complete paragraph about focus and attention that runs long enough to stand on its own as an idea. '.repeat(2)}</p>`
assert.ok(extractIdeas(plain, { rawTitle: 'Some Book Summary' }).length >= 1, 'unstructured articles must degrade, not vanish')

console.log('ok — methods, pomodoro, youtube, reading list, nudges, idea extraction')

// ── sound roles: background loops, guided sessions play once and must fit
const sounds = parseSounds(`
loop  https://youtu.be/jfKfPfyJRdk | Lofi radio
loop  https://www.youtube.com/watch?v=aaaaaaaaaaa | Justin Sung focus music
break https://youtu.be/bbbbbbbbbbb | Wim Hof breathing | 10
break https://youtu.be/ccccccccccc | Box breathing | 5
# comment
https://youtu.be/ddddddddddd | Untagged stays background
`)
assert.equal(sounds.length, 5)
assert.equal(sounds[0].role, 'loop')
assert.equal(sounds[0].name, 'Lofi radio')
assert.equal(sounds[2].role, 'break')
assert.equal(sounds[2].minutes, 10)
assert.equal(sounds[4].role, 'loop', 'an untagged line must stay background')

// a 10-minute session cannot be offered in a 5-minute break
assert.deepEqual(breakSoundsFor(sounds, 5).map(s => s.name), ['Box breathing'])
assert.deepEqual(breakSoundsFor(sounds, 17).map(s => s.name), ['Wim Hof breathing', 'Box breathing'])
assert.equal(breakSoundsFor(sounds, 5).every(s => s.role === 'break'), true, 'background must never be offered as a break session')
// unknown length fits any break
assert.equal(breakSoundsFor(parseSounds('break https://youtu.be/eeeeeeeeeee | Unknown length'), 5).length, 1)

console.log('ok — sound roles and break fitting')

// ── tarot: a full deck, every card usable, no duplicates
assert.equal(CARDS.length, 78, 'a tarot deck is 78 cards')
assert.equal(new Set(CARDS.map(c => c.name)).size, 78, 'no card may appear twice')
assert.ok(CARDS.every(c => c.name && c.image && c.keys), 'every card needs a name, an image and keywords')
// suits are derived from the name, so a court card must not read as major
const bySuit = s => CARDS.filter(c => c.suit === s).length
assert.deepEqual([bySuit('major'), bySuit('wands'), bySuit('cups'), bySuit('swords'), bySuit('pentacles')], [22, 14, 14, 14, 14])
assert.equal(CARDS.find(c => c.name === 'Father of Swords').suit, 'swords')
assert.equal(parseDeck('The Fool | a pup at the cliff | trust').length, 1, 'comments and blanks only')
// lines split on the last dash, so a dash inside the quote survives
assert.deepEqual(parseLines('Know thyself. — Delphi')[0], { text: 'Know thyself.', who: 'Delphi' })
assert.ok(READINGS.length >= 20 && READINGS.every(l => l.text), 'lines must not be empty')

console.log('ok — tarot deck and lines')

// ── companion chat: the window ai_chat accepts
const turn = (role, text) => ({ role, text })
const chat = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? 'model' : 'user', `m${i}`))
chat.push(turn('user', 'last'))
const win = chatWindow(chat)
assert.ok(win.length <= 13, 'never more than 13 turns')
assert.equal(win[0].role, 'user', 'a window opens on a user turn')
assert.equal(win.at(-1).text, 'last', 'the newest message is always sent')
// budget is UTF-8 bytes: 9000 Burmese characters are 27000 bytes, over the cap
const burmese = 'မ'.repeat(9000)
assert.deepEqual(chatWindow([turn('user', burmese), turn('model', 'ok'), turn('user', 'hi')]).map(m => m.text), ['hi'],
  'old turns drop once the byte budget is spent, and the window still opens on a user turn')
assert.equal(chatWindow([turn('user', burmese + burmese)]).length, 1, 'an oversized newest message is still sent, so Rust can explain')

console.log('ok — companion chat window')

// ── coach: day summary, reply parsing, nudge timing
{
  const { buildContext, parseSuggestion, dueNudge, focusPattern } = await import('./coach.js')
  const now = new Date(2026, 9, 12, 14, 5)
  const ctx = buildContext({
    now,
    days: [
      { iso: '2026-10-12', entries: [
        { type: 'task', state: 'open', text: 'Write senior project intro' },
        { type: 'task', state: 'done', text: 'Laundry' },
        { type: 'note', state: 'note', text: 'Focused 25m on Psychology notes' },
      ] },
      { iso: '2026-10-11', entries: [
        { type: 'note', state: 'note', text: 'Focused 30m on Reading' },
        { type: 'task', state: 'done', text: 'Skincare' },
      ] },
    ],
    events: [
      { name: 'Morning class', time_start: '09:00', duration_minutes: 60 },
      { name: 'Gym', time_start: '16:00', duration_minutes: 45 },
    ],
    reading: [{ title: 'Atomic Habits', done: false }, { title: 'Old book', done: true }],
    about: 'senior project',
    skipped: ['Reply to emails'],
  })
  assert.match(ctx, /Now: Monday 14:05/)
  assert.match(ctx, /Open tasks today: Write senior project intro/)
  assert.match(ctx, /Events still ahead today: 16:00 Gym/)
  assert.ok(!ctx.includes('Morning class'), 'past events are left out')
  assert.match(ctx, /Atomic Habits/)
  assert.ok(!ctx.includes('Old book'), 'finished books are left out')
  assert.match(ctx, /Not now .*Reply to emails/)
  assert.match(ctx, /finished Skincare/)
  assert.equal(focusPattern([{ entries: [{ type: 'note', text: 'Focused 10m on a' }] }]), '', 'one session is not a pattern')

  const s = parseSuggestion('```json\n{"next":"Draft the intro","why":"Two hours before gym.","first_step":"Open the doc","minutes":400,"also":["Read Atomic Habits",3,"Rest","x"]}\n```')
  assert.equal(s.next, 'Draft the intro')
  assert.equal(s.minutes, 90, 'minutes are clamped')
  assert.deepEqual(s.also, ['Read Atomic Habits', 'Rest'])
  assert.equal(parseSuggestion('not json'), null)
  assert.equal(parseSuggestion('{"next":""}'), null)

  assert.equal(dueNudge(new Date(2026, 9, 12, 9, 35), ''), '2026-10-12|09:30')
  assert.equal(dueNudge(new Date(2026, 9, 12, 9, 35), '2026-10-12|09:30'), null, 'once per slot')
  assert.equal(dueNudge(new Date(2026, 9, 12, 10, 0), ''), null, 'not long after a slot')
  assert.equal(dueNudge(new Date(2026, 9, 12, 20, 31), '2026-10-12|17:00'), '2026-10-12|20:30')
  console.log("ok — coach context, replies and nudge timing")
}

// ── daily lens: every suit has all four parts; AI replies are checked
{
  const { LOCAL_LENS, localLens, parseLens, buildLensContext } = await import('./coach.js')
  for (const suit of ['major', 'wands', 'cups', 'swords', 'pentacles']) {
    const l = LOCAL_LENS[suit]
    assert.ok(l.mind && l.heart && l.people, `lens missing parts: ${suit}`)
    assert.match(l.ifThen, /^If .+, then I /, `if-then shape: ${suit}`)
  }
  assert.equal(localLens({ suit: 'nope' }).mind, LOCAL_LENS.major.mind)
  const ok = parseLens('{"mind":"a","heart":"b","people":"c","if_then":"If x, then I y."}')
  assert.equal(ok.ifThen, 'If x, then I y.'); assert.equal(ok.source, 'ai')
  assert.equal(parseLens('{"mind":"a","heart":"b"}'), null, 'incomplete lens is rejected')
  assert.equal(parseLens('oops'), null)
  assert.match(buildLensContext({ name: 'The Chariot', suit: 'major', keys: 'drive', image: 'a horse' }, 'Now: Monday'), /The Chariot .*\n.*Now: Monday/s)
  console.log('ok — daily lens')
}

// ── feed: deadlines and the Showcase group
{
  const { withTimeout, parseSources, showcaseNames, DEFAULT_SOURCES, SHOWCASE_SOURCES } = await import('./feed.js')
  const never = new Promise(() => {})
  const t0 = Date.now()
  await assert.rejects(withTimeout(never, 50, 'test'), /timed out: test/)
  assert.ok(Date.now() - t0 < 1000, 'a hanging request is cut off')
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7)
  const src = parseSources('# ── News\nrss https://a.example/feed | A\n# ── Showcase (made with AI)\nreddit threejs | Three\n# just a comment\nrss https://b.example | B')
  assert.deepEqual(src.map(s => s.group), ['', 'showcase', 'showcase'], 'plain comments do not end a group')
  assert.deepEqual([...showcaseNames(src)], ['Three', 'B'])
  assert.ok(showcaseNames(parseSources(DEFAULT_SOURCES)).size >= 5, 'defaults ship a Showcase group')
  assert.ok(showcaseNames(parseSources(SHOWCASE_SOURCES)).size >= 5)
  console.log('ok — feed deadlines and showcase')
}
