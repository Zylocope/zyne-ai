// ─────────────────────────────────────────────────────────────
//  TOOLS — the small self-care screens that open over everything
//  and close again: grounding, and whatever joins it later.
//
//  Nothing here asks you to type. The grounding exercise is a
//  prompt to look around a real room, not a form to fill in, which
//  is also the house rule: no data entry.
// ─────────────────────────────────────────────────────────────

const REDUCED = typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

// 5-4-3-2-1: the senses, widest first. Touch comes second because it is
// the one you can always find — you are already touching something.
export const GROUNDING = [
  { n: 5, sense: 'see',   line: 'Five things you can see.',   hint: 'Let your eyes land on each one.' },
  { n: 4, sense: 'feel',  line: 'Four things you can feel.',  hint: 'The floor, your sleeve, the air.' },
  { n: 3, sense: 'hear',  line: 'Three things you can hear.', hint: 'Listen past the nearest sound.' },
  { n: 2, sense: 'smell', line: 'Two things you can smell.',  hint: 'Faint counts.' },
  { n: 1, sense: 'taste', line: 'One thing you can taste.',   hint: 'Even just your own mouth.' },
]

import { randomLine } from './tarot.js'
import { getSetting, setSetting } from './db.js'
import { addEntry } from './journal.js'

let stage = null

export function closeTool() {
  if (!stage) return
  const el = stage
  stage = null
  el.classList.remove('in')
  setTimeout(() => el.remove(), REDUCED ? 0 : 220)
  document.documentElement.classList.remove('tool-open')
}

function mount(innerHTML, cls = '') {
  closeTool()
  stage = document.createElement('div')
  stage.className = `tool-stage ${cls}`.trim()
  stage.innerHTML = `
    <button class="tool-close" aria-label="Close">&times;</button>
    <div class="tool-body">${innerHTML}</div>`
  stage.querySelector('.tool-close').onclick = closeTool
  // tapping the backdrop leaves; tapping the content does not
  stage.onclick = e => { if (e.target === stage) closeTool() }
  document.body.appendChild(stage)
  document.documentElement.classList.add('tool-open')
  requestAnimationFrame(() => stage.classList.add('in'))
  return stage
}

export function openGrounding() {
  let i = 0
  const el = mount(`
    <div class="g-dots" id="gDots"></div>
    <div class="g-card" id="gCard"></div>
    <button class="btn-primary g-next" id="gNext">Next</button>`, 'tool-ground')

  const dots = el.querySelector('#gDots')
  const card = el.querySelector('#gCard')
  const next = el.querySelector('#gNext')

  const draw = () => {
    const s = GROUNDING[i]
    dots.innerHTML = GROUNDING.map((_, k) =>
      `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')
    card.innerHTML = `
      <div class="g-count">${s.n}</div>
      <div class="g-line">${s.line}</div>
      <div class="g-hint">${s.hint}</div>`
    card.classList.remove('in')
    requestAnimationFrame(() => card.classList.add('in'))
    next.textContent = i === GROUNDING.length - 1 ? 'Done' : 'Next'
  }

  next.onclick = () => {
    if (i === GROUNDING.length - 1) {
      card.innerHTML = `<div class="g-line g-end">Back in the room.</div>`
      dots.innerHTML = GROUNDING.map(() => '<i class="done"></i>').join('')
      next.style.display = 'none'
      setTimeout(closeTool, REDUCED ? 600 : 1600)
      return
    }
    i++
    draw()
  }
  draw()
  return el
}

// A screen with nothing to do. No timer, no counter, no sound of its own —
// the sound chips already handle audio, and pulling a YouTube player in here
// would drag their visible-player policy along with it. Tap for another line.
export function openCalm() {
  const el = mount(`
    <div class="c-orb" aria-hidden="true"></div>
    <button class="c-line" id="cLine" aria-label="Another line"></button>
    <div class="c-hint">tap for another · close when you're ready</div>`, 'tool-calm')

  const btn = el.querySelector('#cLine')
  const show = () => {
    const l = randomLine()
    btn.innerHTML = `${l.text}${l.who ? ` <span class="c-who">${l.who}</span>` : ''}`
    btn.classList.remove('in')
    requestAnimationFrame(() => btn.classList.add('in'))
  }
  btn.onclick = show
  show()
  return el
}

// ─── the jar ──────────────────────────────────────────────────
// Good moments, kept. Typing one line is the whole feature here, so this
// is the one screen that asks for input — but it is a note, not a form:
// no fields, no date picker, no category. The line also lands in today's
// journal, so the vault keeps the real record and the jar stays a view.
const JAR_MAX = 300
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const readJar = async () => {
  try { return JSON.parse((await getSetting('jar')) || '[]') } catch { return [] }
}

export async function openJar() {
  let jar = await readJar()
  const el = mount(`
    <div class="jar-glass" aria-hidden="true"><span id="jarCount"></span></div>
    <div class="jar-pulled" id="jarPulled"></div>
    <div class="jar-add">
      <input id="jarInput" class="input-field" maxlength="140" autocomplete="off"
             placeholder="something good, in a few words">
      <button class="btn-primary" id="jarAdd">Keep</button>
    </div>
    <button class="jar-pull" id="jarPull">Pull one out</button>`, 'tool-jar')

  const count = el.querySelector('#jarCount')
  const pulled = el.querySelector('#jarPulled')
  const input = el.querySelector('#jarInput')

  // motes in the jar, capped so a full jar does not become a crowd
  const paint = () => {
    count.textContent = jar.length ? jar.length : ''
    el.querySelector('.jar-glass').dataset.full = Math.min(jar.length, 40)
  }

  const add = async () => {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    jar = [{ d: todayISO(), t: text }, ...jar].slice(0, JAR_MAX)
    await setSetting('jar', JSON.stringify(jar))
    paint()
    pulled.innerHTML = `<div class="jar-note in">${text}</div>`
    try { await addEntry(todayISO(), 'note', `Good: ${text}`) } catch (e) { console.warn('jar:', e) }
  }

  const pull = () => {
    if (!jar.length) { pulled.innerHTML = `<div class="jar-note in jar-empty">Nothing in here yet.</div>`; return }
    const one = jar[Math.floor(Math.random() * jar.length)]
    pulled.innerHTML = `<div class="jar-note"><span class="jar-when">${one.d}</span>${one.t}</div>`
    requestAnimationFrame(() => pulled.firstElementChild.classList.add('in'))
  }

  el.querySelector('#jarAdd').onclick = add
  el.querySelector('#jarPull').onclick = pull
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add() } }
  paint()
  return el
}
