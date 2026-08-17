// Self-check for the pure logic behind Focus, Library and book ideas.
// Run:  node src/js/focus-library.test.js
import assert from 'node:assert/strict'
import { nextPhase, youtubeId, parseSounds, fmtClock, METHODS, methodByKey, breakSoundsFor } from './focus.js'
import { parseList, serializeList, buildNudges, daysSince, slug } from './library.js'
import { extractIdeas, bookFromTitle } from './books.js'

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
