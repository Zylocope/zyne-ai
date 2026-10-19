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
import { addEntry, loadDay } from './journal.js'

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

// Both guided screens are the same shape: dots, a card, one button. The
// caller supplies what a step looks like and what happens at the end.
function stepper(steps, { cls, render, finish }) {
  let i = 0
  const el = mount(`
    <div class="g-dots" id="gDots"></div>
    <div class="g-card" id="gCard"></div>
    <button class="btn-primary g-next" id="gNext">Next</button>`, cls)

  const dots = el.querySelector('#gDots')
  const card = el.querySelector('#gCard')
  const next = el.querySelector('#gNext')

  const draw = () => {
    dots.innerHTML = steps.map((_, k) =>
      `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')
    card.innerHTML = render(steps[i], i)
    card.classList.remove('in')
    requestAnimationFrame(() => card.classList.add('in'))
    next.textContent = i === steps.length - 1 ? 'Done' : 'Next'
  }

  next.onclick = () => {
    if (i === steps.length - 1) {
      dots.innerHTML = steps.map(() => '<i class="done"></i>').join('')
      finish({ el, card, next })
      return
    }
    i++
    draw()
  }
  draw()
  return el
}

export function openGrounding() {
  return stepper(GROUNDING, {
    cls: 'tool-ground',
    render: s => `
      <div class="g-count">${s.n}</div>
      <div class="g-line">${s.line}</div>
      <div class="g-hint">${s.hint}</div>`,
    finish: ({ card, next }) => {
      card.innerHTML = `<div class="g-line g-end">Back in the room.</div>`
      next.style.display = 'none'
      setTimeout(closeTool, REDUCED ? 600 : 1600)
    },
  })
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

// ─── reflection ───────────────────────────────────────────────
// Guided questions, answered in your head. Local, not AI: Gemini is off
// unless you turn it on, and a question set does not need a model to be
// worth sitting with. Only the closing takeaway is typed, and only if you
// want it kept.
export const REFLECT = [
  { q: 'Name it in one word.',                     hint: 'Angry, dread, flat, restless. Naming a feeling lowers its volume.' },
  { q: 'Where do you feel it?',                    hint: 'Jaw, chest, stomach, shoulders. Feelings land somewhere.' },
  { q: 'What is it actually about?',               hint: 'Not the thing that set it off — the thing underneath that.' },
  { q: 'Which part of this is yours to move?',     hint: 'Some of it is not. That part can be set down.' },
  { q: 'What is one small thing you could do?',    hint: 'Small enough to do today, not a plan for your life.' },
]

export function openReflect(moodLabel) {
  return stepper(REFLECT, {
    cls: 'tool-reflect',
    render: (s, i) => `
      ${i === 0 && moodLabel ? `<div class="g-hint r-opening">You marked today ${moodLabel.toLowerCase()}.</div>` : ''}
      <div class="g-line r-q">${s.q}</div>
      <div class="g-hint">${s.hint}</div>`,
    finish: ({ el, card, next }) => {
      next.style.display = 'none'
      card.innerHTML = `
        <div class="g-line">Keep one line from that?</div>
        <div class="g-hint">Only if it is worth reading again.</div>
        <div class="jar-add r-keep">
          <input id="rInput" class="input-field" maxlength="140" autocomplete="off" placeholder="optional">
          <button class="btn-primary" id="rSave">Keep</button>
        </div>
        <button class="jar-pull" id="rSkip">No need</button>`
      card.classList.add('in')
      const done = () => { card.innerHTML = `<div class="g-line g-end">Sorted, for now.</div>`; setTimeout(closeTool, REDUCED ? 600 : 1400) }
      el.querySelector('#rSkip').onclick = done
      el.querySelector('#rSave').onclick = async () => {
        const text = el.querySelector('#rInput').value.trim()
        if (text) { try { await addEntry(todayISO(), 'note', `Reflected: ${text}`) } catch (e) { console.warn('reflect:', e) } }
        done()
      }
      el.querySelector('#rInput').onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); el.querySelector('#rSave').click() }
      }
    },
  })
}

// ─── temperature ──────────────────────────────────────────────
// A look back, not another input. The mood is already logged and the day
// already has notes, so this reads them rather than asking for anything
// new. Counts per mood, never a run of days — a streak would turn a
// feeling into a score to protect.
const DAY_MS = 86400000
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function lastDays(n, today = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(isoOf(new Date(today.getTime() - i * DAY_MS)))
  return out
}

// "mostly good · some rough" — the shape of a stretch, in words
export function summarise(days, moodLog, moods) {
  const counts = new Map()
  for (const iso of days) {
    const k = moodLog[iso]
    if (k) counts.set(k, (counts.get(k) || 0) + 1)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  if (!total) return 'Nothing logged yet.'
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const label = k => moods.find(m => m.key === k)?.label.toLowerCase() || k
  const lead = `mostly ${label(ranked[0][0])}`
  const rest = ranked.length > 1 ? `, some ${label(ranked[1][0])}` : ''
  return `${total} day${total === 1 ? '' : 's'} logged — ${lead}${rest}`
}

export function openTemperature(moodLog, moods) {
  const days = lastDays(30)
  const tone = iso => moods.find(m => m.key === moodLog[iso])?.tone
  const el = mount(`
    <div class="t-head">The last 30 days</div>
    <div class="t-strip">${days.map(iso => {
      const c = tone(iso)
      return `<button class="t-day${c ? ' on' : ''}" data-iso="${iso}"
                ${c ? `style="--tone:${c}"` : ''} aria-label="${iso}"></button>`
    }).join('')}</div>
    <div class="t-sum">${summarise(days, moodLog, moods)}</div>
    <div class="t-detail" id="tDetail"><div class="t-hint">Tap a day to see what was going on.</div></div>`, 'tool-temp')

  const detail = el.querySelector('#tDetail')
  el.querySelectorAll('.t-day').forEach(b => {
    b.onclick = async () => {
      el.querySelectorAll('.t-day').forEach(o => o.classList.remove('sel'))
      b.classList.add('sel')
      const iso = b.dataset.iso
      const mood = moods.find(m => m.key === moodLog[iso])
      let notes = []
      try { notes = (await loadDay(iso)).filter(e => e.type === 'note') } catch { notes = [] }
      detail.innerHTML = `
        <div class="t-date">${iso}${mood ? ` · ${mood.label.toLowerCase()}` : ''}</div>
        ${notes.length
          ? `<ul class="t-notes">${notes.slice(0, 6).map(n => `<li>${n.text}</li>`).join('')}</ul>`
          : `<div class="t-hint">No notes that day.</div>`}`
    }
  })
  return el
}

// ─── borrowed goals ───────────────────────────────────────────
// A shelf of small, ordinary self-care tasks. Tap one and it becomes a
// task in today's journal — no typing, which is the point: the hard part
// of a habit is rarely writing it down. Already-added ones are marked so
// the same goal does not land twice.
export const GOALS = [
  ['Morning', ['Wake at a steady time', 'Make the bed', 'Step outside for a minute', 'Drink a glass of water']],
  ['Body',    ['Walk for fifteen minutes', 'Stretch your shoulders', 'Eat something green', 'Be in bed by midnight']],
  ['Mind',    ['Read ten pages', 'One hour away from the phone', 'Write down what is on your mind', 'Sit still for five minutes']],
  ['Home',    ['Clear one surface', 'Wash tonight’s dishes', 'Open a window', 'Put away what is out']],
  ['People',  ['Message someone you miss', 'Thank one person properly', 'Ask someone how they really are']],
]

export async function openGoals(onAdd) {
  const iso = todayISO()
  let existing = new Set()
  try { existing = new Set((await loadDay(iso)).filter(e => e.type === 'task').map(e => e.text)) } catch {}

  const el = mount(`
    <div class="t-head">Borrow a goal for today</div>
    <div class="goal-groups">${GOALS.map(([group, items]) => `
      <div class="goal-group">
        <div class="goal-label">${group}</div>
        ${items.map(t => `
          <button class="goal${existing.has(t) ? ' added' : ''}" data-text="${t.replace(/"/g, '&quot;')}">
            <span>${t}</span><i></i>
          </button>`).join('')}
      </div>`).join('')}</div>`, 'tool-goals')

  el.querySelectorAll('.goal').forEach(b => {
    b.onclick = async () => {
      if (b.classList.contains('added')) return
      b.classList.add('added')
      try {
        await addEntry(iso, 'task', b.dataset.text)
        onAdd?.()
      } catch (e) { console.warn('goal:', e); b.classList.remove('added') }
    }
  })
  return el
}
