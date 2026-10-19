// ─────────────────────────────────────────────────────────────
//  CARD 3D — full-screen stage for the daily card (phone).
//  Pure CSS 3D, no WebGL: crisp text, cheap on a phone, works offline.
//    · not drawn yet → three face-down cards fan out; tap one to draw
//    · drawn → the card floats face up; drag to tilt, swipe to spin it
//      over, tilt the phone and it follows; tap to flip
//  The app owns the deck and the journal; this file only draws and moves.
// ─────────────────────────────────────────────────────────────

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
let stage = null

// opts: { front(card) → html, back → html, card|null, line → html, onDraw() → Promise<card> }
export function openCardStage(opts) {
  closeCardStage()
  stage = document.createElement('div')
  stage.className = 'c3-stage'
  stage.setAttribute('role', 'dialog')
  stage.setAttribute('aria-label', "Today's card")
  stage.innerHTML = `
    <button class="c3-close" aria-label="Close">×</button>
    <div class="c3-eyebrow">${opts.card ? 'TODAY’S CARD' : 'PICK ONE'}</div>
    <div class="c3-table"></div>
    <div class="c3-read" aria-live="polite"></div>
    <div class="c3-hint">${opts.card ? 'Drag or tilt your phone · swipe to turn it over' : 'Tap the card that pulls you'}</div>`
  document.body.appendChild(stage)
  document.documentElement.classList.add('c3-open')
  requestAnimationFrame(() => stage?.classList.add('in'))

  const table = stage.querySelector('.c3-table')
  const close = () => closeCardStage()
  stage.querySelector('.c3-close').onclick = close
  stage.addEventListener('click', e => { if (e.target === stage) close() })
  stage._onKey = e => { if (e.key === 'Escape') close() }
  window.addEventListener('keydown', stage._onKey)

  if (opts.card) {
    const c = makeCard(opts.back, opts.front(opts.card), opts.card.suit)
    table.appendChild(c.el)
    showReading(opts.card, opts.line)
    showExtra(opts, opts.card)
    mountMotion(c, 180)
    return
  }

  // fan of three face-down cards
  const fan = [-1, 0, 1].map(i => {
    const c = makeCard(opts.back, '', '')
    c.el.classList.add('c3-fan')
    c.el.style.setProperty('--i', i)
    table.appendChild(c.el)
    return c
  })
  requestAnimationFrame(() => table.classList.add('spread'))
  fan.forEach(c => c.el.addEventListener('click', async () => {
    if (table.classList.contains('chosen')) return
    table.classList.add('chosen')
    fan.forEach(o => o.el.classList.toggle('picked', o === c))
    const card = await opts.onDraw()
    c.front.innerHTML = opts.front(card)
    c.el.dataset.suit = card.suit
    await wait(REDUCED ? 0 : 450)
    fan.filter(o => o !== c).forEach(o => o.el.remove())
    c.el.classList.remove('c3-fan', 'picked')
    stage.querySelector('.c3-eyebrow').textContent = 'TODAY’S CARD'
    stage.querySelector('.c3-hint').textContent = 'Drag or tilt your phone · swipe to turn it over'
    mountMotion(c, 0, 180)          // starts face down, spins up
    showReading(card, opts.line)
    showExtra(opts, card)
  }, { once: false }))
}

export function closeCardStage() {
  if (!stage) return
  const s = stage
  stage = null
  s._stop?.()
  window.removeEventListener('keydown', s._onKey)
  document.documentElement.classList.remove('c3-open')
  s.classList.remove('in')
  setTimeout(() => s.remove(), REDUCED ? 0 : 260)
}

// Anything the app wants under the card (the daily lens). Loads after.
async function showExtra(opts, card) {
  if (!opts.extra || !stage) return
  const box = document.createElement('div')
  box.className = 'c3-extra'
  box.innerHTML = '<div class="c3-wait">Reading your day…</div>'
  stage.querySelector('.c3-read')?.after(box)
  const mine = stage
  let html = ''
  try { html = await opts.extra(card) } catch { html = '' }
  if (stage !== mine) return                    // closed meanwhile
  box.innerHTML = html
  if (!html) box.remove()
}

function showReading(_card, line) {
  const r = stage?.querySelector('.c3-read')
  if (!r) return
  // the card itself carries name, image and keys; below it only the line
  r.innerHTML = `
    ${line ? `<div class="c3-line">${line}</div>` : ''}
    <div class="c3-saved">SAVED IN TODAY’S JOURNAL</div>`
  requestAnimationFrame(() => r.classList.add('in'))
}

// A card with real thickness: back face, a few edge layers, front face.
function makeCard(backHTML, frontHTML, suit) {
  const el = document.createElement('div')
  el.className = 'c3-card'
  if (suit) el.dataset.suit = suit
  el.innerHTML = `
    <div class="c3-body">
      <div class="c3-face c3-back">${backHTML}<i class="c3-sheen"></i></div>
      <i class="c3-edge" style="--z:-1.2px"></i><i class="c3-edge" style="--z:-.4px"></i>
      <i class="c3-edge" style="--z:.4px"></i><i class="c3-edge" style="--z:1.2px"></i>
      <div class="c3-face c3-front">${frontHTML}<i class="c3-sheen"></i></div>
    </div>`
  return { el, body: el.querySelector('.c3-body'), front: el.querySelector('.c3-front') }
}

// Drag tilts; a fast or long horizontal swipe spins it to the other side;
// a tap flips; the phone's own tilt adds a gentle lean on top.
function mountMotion(c, startRy, targetRy = startRy) {
  let ry = startRy, rx = 0, target = targetRy, vx = 0
  let drag = null, gx = 0, gy = 0, base = null, raf = 0
  const body = c.body

  const down = e => {
    drag = { x: e.clientX, y: e.clientY, ry, t: performance.now(), moved: false, lastX: e.clientX, lastT: performance.now() }
    c.el.setPointerCapture?.(e.pointerId)
  }
  const move = e => {
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true
    const now = performance.now()
    vx = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT)
    drag.lastX = e.clientX; drag.lastT = now
    target = drag.ry + dx * 0.55
    rx = clamp(-dy * 0.25, -22, 22)
  }
  const up = () => {
    if (!drag) return
    const tap = !drag.moved
    drag = null
    if (tap) { target = snap(target) + 180; return }
    // momentum, then settle on a face so it never rests edge-on
    target = snap(target + clamp(vx, -3, 3) * 160)
    rx = 0
  }
  c.el.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)

  const orient = e => {
    if (e.gamma == null || e.beta == null) return
    if (!base) base = { g: e.gamma, b: e.beta }
    gx = clamp((e.gamma - base.g) * 0.6, -14, 14)
    gy = clamp((e.beta - base.b) * -0.5, -12, 12)
  }
  window.addEventListener('deviceorientation', orient)

  let shownRx = 0
  const tick = () => {
    ry += (target - ry) * (REDUCED ? 1 : drag ? 0.35 : 0.12)
    shownRx += ((drag ? rx : 0) + gy - shownRx) * 0.15
    const y = ry + gx
    body.style.transform = `rotateX(${shownRx.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`
    // light moves across the foil as the card turns
    const sx = 50 + Math.sin(y * Math.PI / 180) * 60, sy = 50 - shownRx * 2
    c.el.style.setProperty('--sx', `${sx.toFixed(1)}%`)
    c.el.style.setProperty('--sy', `${sy.toFixed(1)}%`)
    // the art rides slightly against the card it sits in, so the printed
    // frame reads as nearer than the picture. A 2D shift, not a Z plane:
    // .c3-face uses overflow:hidden, which flattens preserve-3d anyway.
    c.el.style.setProperty('--px', `${(Math.sin(y * Math.PI / 180) * -7).toFixed(2)}px`)
    c.el.style.setProperty('--py', `${(shownRx * 0.22).toFixed(2)}px`)
    const dropX = clamp(-Math.sin(y * Math.PI / 180) * 18, -18, 18)
    c.el.style.setProperty('--drop', `${dropX.toFixed(1)}px`)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  stage._stop = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('deviceorientation', orient)
  }
}

const snap = a => Math.round(a / 180) * 180
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const wait = ms => new Promise(r => setTimeout(r, ms))
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
