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

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
