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
