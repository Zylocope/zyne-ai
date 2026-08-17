// ─────────────────────────────────────────────────────────────
//  ZYNE.AI — MAIN APP LOGIC
//  Phone: Feed (news + a Books chip) · Journal.
//  Laptop: Focus (timer + sounds) · Library (book ideas) · Journal.
//  The "+" timer appears on both, hosted by whichever page owns it.
// ─────────────────────────────────────────────────────────────

import {
  getDb,
  getSchedule, saveScheduleItem, deleteScheduleItem,
  getSetting, setSetting,
  upsertFeedItems, getUnseenFeed, markFeedSeen, markAllFeedSeen,
  getUnscoredFeed, applyFeedScores,
} from './db.js'

import {
  toISODate, buildMonthGrid, itemsForDate,
  minutesFromTime, timeFromMinutes, recurrenceLabel,
} from './schedule.js'

import { DEFAULT_SOURCES, SOURCES_SEED_VERSION, parseSources, fetchAllSources, interleaveBySource } from './feed.js'
import { loadDay, addEntry, setTaskState, deleteEntry, clipItem } from './journal.js'
import { DEFAULT_PROFILE, rankItems, scoreLocally } from './ranker.js'
import {
  METHODS, methodByKey, isCountUp, DEFAULT_SOUNDS, nextPhase, phaseLabel,
  phaseMinutes, fmtClock, parseSounds, breakSoundsFor,
} from './focus.js'
import { listWant, addWant, toggleWant, removeWant, saveIdea, buildNudges } from './library.js'

// ─── STATE ───────────────────────────────────────────────────
let feedItems = []                             // current unseen batch
let feedItemById = new Map()
let kindFilter = 'all'
let entryType = 'task'                         // composer: task | note | event
let journalEntries = []                        // md entries for selected day

// Calendar state
let calendarItems = []                         // schedule_items rows from db
let calendarAnchor = new Date()                // month shown in mini-month
let calendarSelected = new Date()              // day shown in the log
let notifiedItemKeys = new Set()
let notifyTimer = null

// Focus state
let IS_PHONE = false
let focusCfg = METHODS[0]
let soundsText = DEFAULT_SOUNDS
let timerPhase = 'focus'
let timerLeft = METHODS[0].focus * 60
let timerElapsed = 0          // flowtime counts up instead of down
let timerRunning = false
let timerEndsAt = 0
let timerStartedAt = 0
let timerHandle = null
let roundsDone = 0
let sessionLabel = ''
let composing = false         // "+" pressed, waiting for a label
let wantList = []
let libraryView = 'ideas'
let lastLoopIndex = -1

// ═════════════════════════════════════════════════════════════
//  PIN LOCK
//  A convenience lock, not a security boundary — the data on disk
//  is not encrypted. The PIN is chosen on first run and its hash is
//  stored locally, never in this source: a 6-digit SHA-256 is a
//  1,000,000-entry search, so a committed hash is a published PIN.
// ═════════════════════════════════════════════════════════════
let pinBuffer = ''
let pinHash = null
let pinStage = 'enter'   // 'set' → 'confirm' on first run, else 'enter'
let pinFirst = ''

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function pinMsg(text) {
  const el = document.getElementById('pinMsg')
  if (el) el.textContent = text
}

function renderPinDots() {
  document.querySelectorAll('#pinDots span').forEach((d, i) => {
    d.classList.toggle('filled', i < pinBuffer.length)
  })
}

async function loadPin() {
  try { pinHash = await getSetting('pin_hash') } catch { pinHash = null }
  pinStage = pinHash ? 'enter' : 'set'
  pinMsg(pinHash ? 'Enter PIN' : 'Choose a 6-digit PIN')
}

function pinUnlock() {
  const lock = document.getElementById('pinLock')
  if (!lock) return
  lock.classList.add('unlocked')
  setTimeout(() => lock.remove(), 350)
}

function pinReject(message) {
  const dots = document.getElementById('pinDots')
  dots?.classList.add('shake')
  pinMsg(message)
  setTimeout(() => dots?.classList.remove('shake'), 450)
}

async function pinPress(digit) {
  if (pinBuffer.length >= 6) return
  pinBuffer += digit
  renderPinDots()
  if (pinBuffer.length < 6) return

  const entered = pinBuffer
  pinBuffer = ''

  if (pinStage === 'set') {
    pinFirst = entered
    pinStage = 'confirm'
    pinMsg('Enter it again to confirm')
  } else if (pinStage === 'confirm') {
    if (entered === pinFirst) {
      pinHash = await sha256hex(entered)
      await setSetting('pin_hash', pinHash)
      pinUnlock()
    } else {
      pinStage = 'set'
      pinReject('Did not match — choose again')
    }
  } else if ((await sha256hex(entered)) === pinHash) {
    pinUnlock()
  } else {
    pinReject('Wrong PIN')
  }
  renderPinDots()
}

function pinBack() {
  pinBuffer = pinBuffer.slice(0, -1)
  renderPinDots()
}

// ═════════════════════════════════════════════════════════════
//  BOOT
// ═════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init)

async function init() {
  IS_PHONE = /Android|iPhone|iPad/.test(navigator.userAgent)
  document.documentElement.classList.add(IS_PHONE ? 'is-mobile' : 'is-desktop')
  updateClock()
  setInterval(updateClock, 30_000)
  bindInputs()

  try { await getDb() } catch (e) { console.warn('DB init skipped:', e) }
  await loadPin()          // first run asks you to choose one

  // The timer lives on both platforms; only its host differs.
  await loadFocusSettings()

  await renderFeedFromDb()
  if (IS_PHONE) {
    refreshFeed()                 // phone reads the news feed, so fetch everything
  } else {
    switchPage('focus')           // laptop opens on work, not browsing
    await loadLibrary()
    refreshFeed({ booksOnly: true })   // only book sources matter here
  }

  await loadJournal()
  startReminderLoop()
}

function updateClock() {
  const now = new Date()
  const s = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const el = document.getElementById('clockDisplay')
  if (el) el.textContent = s
}

// ═════════════════════════════════════════════════════════════
//  PAGE NAVIGATION
// ═════════════════════════════════════════════════════════════
function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('page-' + page)?.classList.add('active')
  document.getElementById('nav-'  + page)?.classList.add('active')
}

// ═════════════════════════════════════════════════════════════
//  FEED
// ═════════════════════════════════════════════════════════════
async function getSourcesText() {
  let text = await getSetting('sources')
  const seedV = await getSetting('sources_seed_v')
  if (!text || (seedV || '1') < SOURCES_SEED_VERSION) {
    text = DEFAULT_SOURCES
    await setSetting('sources', text)
    await setSetting('sources_seed_v', SOURCES_SEED_VERSION)
  }
  return text
}

const SKELETON = `
  <div class="feed-grid">
    ${Array.from({ length: 6 }, (_, i) => `
      <div class="fcard skeleton ${i === 0 ? 'span2' : ''}">
        <div class="sk-thumb"></div>
        <div class="fcard-body"><div class="sk-line"></div><div class="sk-line short"></div></div>
      </div>`).join('')}
  </div>`

async function refreshFeed(opts = {}) {
  const btn = document.getElementById(IS_PHONE ? 'refreshBtn' : 'libRefreshBtn')
  btn?.classList.add('spinning')
  if (!feedItems.length) {
    const host = document.getElementById('feedList')
    if (host) host.innerHTML = SKELETON
  }
  try {
    let sources = parseSources(await getSourcesText())
    if (opts.booksOnly) sources = sources.filter(s => s.type === 'books')
    const { items, errors } = await fetchAllSources(sources)
    if (errors.length) console.warn('feed errors:', errors)
    await upsertFeedItems(items)
    await renderFeedFromDb()
    await rankNewItems()          // one cheap Haiku call, if an API key is set
    await renderFeedFromDb()      // re-render with scores + hooks
  } catch (e) {
    console.warn('refreshFeed:', e)
  } finally {
    btn?.classList.remove('spinning')
  }
}

// Score unseen+unscored items against the interest profile. Uses Haiku when a
// key is set and working; otherwise falls back to free local keyword scoring,
// which leaves hooks null so a later Haiku pass can still upgrade them.
async function rankNewItems() {
  const unscored = await getUnscoredFeed(150)
  if (!unscored.length) return
  const profile = (await getSetting('interest_profile')) || DEFAULT_PROFILE
  const apiKey = await getSetting('anthropic_key')
  if (apiKey) {
    try {
      await applyFeedScores(await rankItems(unscored, profile, apiKey))
      return
    } catch (e) {
      console.warn('rankNewItems (falling back to local):', e)
      flashToast(/402|credit|balance/i.test(e.message) ? 'API out of credits — local ranking' : 'AI ranking failed — local ranking')
    }
  }
  await applyFeedScores(scoreLocally(unscored, profile))
}

async function renderFeedFromDb() {
  // Wide unseen pool → ranked order when scores exist, else round-robin
  const pool = await getUnseenFeed(300)
  const ranked = pool.some(i => (i.score || 0) > 0)
  if (ranked) {
    // Score desc, capped at 4 per source so one feed can't own the top
    const perSource = new Map()
    feedItems = []
    for (const it of pool) {
      const n = perSource.get(it.source) || 0
      if (n >= 4) continue
      perSource.set(it.source, n + 1)
      feedItems.push(it)
      if (feedItems.length >= 60) break
    }
  } else {
    feedItems = interleaveBySource(pool, 60)
  }
  feedItemById = new Map(feedItems.map(i => [i.id, i]))
  renderFeed()
  if (!IS_PHONE) renderLibrary()
}

function setKindFilter(kind) {
  kindFilter = kind
  document.querySelectorAll('#kindChips .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.kind === kind))
  renderFeed()
}

function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

function favicon(url) {
  try {
    const host = new URL(url).hostname
    return `<img class="fcard-favicon" src="https://www.google.com/s2/favicons?domain=${host}&sz=64" alt="" loading="lazy">`
  } catch { return '' }
}

const CLIP_SVG = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`

function cardHTML(it) {
  const meta = `<div class="fcard-meta">${favicon(it.url)}<span class="fcard-source">${esc(it.source)}</span><span class="fcard-dot">·</span><span>${timeAgo(it.published_at)}</span></div>`
  const clip = `<button class="fcard-clip" onclick="event.stopPropagation();window.clipFeedItem('${it.id}')" title="Clip to Obsidian" aria-label="Clip to Obsidian vault">${CLIP_SVG}</button>`
  const hook = it.hook || it.summary

  if (it.kind === 'video') {
    return `
      <article class="fcard fcard-video span2" onclick="window.openFeedItem('${it.id}')">
        <div class="fcard-thumb">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : ''}
          <div class="fcard-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg></div>
          <div class="fcard-thumb-fade"></div>
        </div>
        <div class="fcard-body">
          <div class="fcard-title">${esc(it.title)}</div>
          ${meta}
        </div>
        ${clip}
      </article>`
  }
  if (it.kind === 'idea') {
    // one idea from a book — the card you read, with the book as the invitation
    return `
      <article class="fcard fcard-idea span2">
        <div class="fcard-body">
          <div class="idea-head"><span class="idea-label">${esc(it.label || 'idea')}</span><span class="idea-src">${esc(it.source)}</span></div>
          <div class="idea-text">${esc(it.text || it.summary)}</div>
          <div class="idea-book">${esc(it.book || it.title)}${it.author ? `<span class="idea-author"> · ${esc(it.author)}</span>` : ''}</div>
          <div class="idea-actions">
            <button class="btn-mini" onclick="event.stopPropagation();window.wantBook('${it.id}')">+ WANT TO READ</button>
            <button class="btn-mini" onclick="event.stopPropagation();window.saveIdeaCard('${it.id}')">SAVE IDEA</button>
            <button class="btn-mini" onclick="event.stopPropagation();window.openFeedItem('${it.id}')">FULL SUMMARY ↗</button>
          </div>
        </div>
      </article>`
  }
  if (it.kind === 'repo') {
    return `
      <article class="fcard fcard-tile fcard-repo" onclick="window.openFeedItem('${it.id}')">
        <div class="fcard-body">
          <div class="fcard-repo-name"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 22v-3a3.4 3.4 0 00-1-2.7c3.2-.4 6.5-1.5 6.5-7A5.4 5.4 0 0020 5.6 5 5 0 0019.9 2s-1.2-.4-4 1.5a13.4 13.4 0 00-7 0C6.1 1.6 4.9 2 4.9 2A5 5 0 004.8 5.6 5.4 5.4 0 003.3 9.3c0 5.5 3.3 6.6 6.5 7a3.4 3.4 0 00-1 2.7v3"/></svg> ${esc(it.title)}</div>
          ${it.stars ? `<div class="fcard-stars">★ ${Number(it.stars).toLocaleString()}</div>` : ''}
          ${hook ? `<div class="fcard-hook">${esc(hook)}</div>` : ''}
          ${meta}
        </div>
        ${clip}
      </article>`
  }
  // article / post → tile
  return `
    <article class="fcard fcard-tile" onclick="window.openFeedItem('${it.id}')">
      ${it.thumb ? `<div class="fcard-tile-thumb"><img src="${esc(it.thumb)}" alt="" loading="lazy"></div>` : ''}
      <div class="fcard-body">
        <div class="fcard-title">${esc(it.title)}</div>
        ${!it.thumb && hook ? `<div class="fcard-hook">${esc(hook)}</div>` : ''}
        ${meta}
      </div>
      ${clip}
    </article>`
}

function renderFeed() {
  const host = document.getElementById('feedList')
  if (!host) return
  // "All" keeps book ideas out of the news feed — they have their own chip
  const visible = kindFilter === 'all' ? feedItems.filter(i => i.kind !== 'idea')
    : kindFilter === 'article' ? feedItems.filter(i => i.kind === 'article' || i.kind === 'repo')
    : feedItems.filter(i => i.kind === kindFilter)
  if (!visible.length) {
    host.innerHTML = caughtUpHTML(true)
    return
  }
  host.innerHTML = `<div class="feed-grid">${visible.map(cardHTML).join('')}</div>` + caughtUpHTML(false, visible.length)
}

function caughtUpHTML(empty, count = 0) {
  return `
    <div class="caught-up">
      <svg width="30" height="30" fill="none" stroke="var(--learn)" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <div class="caught-up-title">${empty ? 'Nothing new here' : "You're caught up"}</div>
      <div class="caught-up-sub">${empty ? 'Try another filter or refresh.' : `${count} items in this batch.`}</div>
      ${empty ? '' : `<button class="btn-mini" onclick="window.clearFeedBatch()">✓ MARK ALL READ</button>`}
    </div>`
}

async function openFeedItem(id) {
  const it = feedItemById.get(id)
  if (!it) return
  markFeedSeen(id).catch(() => {})
  document.querySelector(`.fcard[onclick*="${id}"]`)?.classList.add('read')
  try {
    const mod = await import('@tauri-apps/plugin-opener')
    await mod.openUrl(it.url)
  } catch {
    window.open(it.url, '_blank')
  }
}

async function clipFeedItem(id) {
  const it = feedItemById.get(id)
  if (!it) return
  try {
    await clipItem(it)
    flashToast('Clipped to vault')
  } catch (e) {
    console.warn('clip:', e)
    flashToast('Clip failed')
  }
}

async function clearFeedBatch() {
  await markAllFeedSeen()
  await renderFeedFromDb()
}

async function toggleSettings() {
  const sheet = document.getElementById('settingsSheet')
  if (sheet.style.display === 'none') {
    document.getElementById('apiKeyInput').value = (await getSetting('anthropic_key')) || ''
    document.getElementById('profileText').value = (await getSetting('interest_profile')) || DEFAULT_PROFILE
    document.getElementById('sourcesText').value = await getSourcesText()
    sheet.style.display = 'flex'
  } else {
    sheet.style.display = 'none'
  }
}

async function saveSettings() {
  await setSetting('anthropic_key', document.getElementById('apiKeyInput').value.trim())
  await setSetting('interest_profile', document.getElementById('profileText').value)
  await setSetting('sources', document.getElementById('sourcesText').value)
  document.getElementById('settingsSheet').style.display = 'none'
  flashToast('Saved')
  refreshFeed()
}

function flashToast(msg) {
  let t = document.getElementById('toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'toast'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2200)
}

// ═════════════════════════════════════════════════════════════
//  FOCUS  (Pomodoro + focus sounds + break review)
// ═════════════════════════════════════════════════════════════
let timerHost = null

async function loadFocusSettings() {
  focusCfg = methodByKey(await getSetting('focus_method'))
  soundsText = (await getSetting('focus_sounds')) || DEFAULT_SOUNDS
  lastLoopIndex = parseInt(await getSetting('last_sound'))
  if (!Number.isInteger(lastLoopIndex)) lastLoopIndex = -1
  timerLeft = phaseMinutes(timerPhase, focusCfg) * 60
  // One timer. On phones the whole slot (timer + break panel) moves into the
  // Journal page, where Activity Tap used to live.
  if (IS_PHONE) {
    const slot = document.getElementById('focusSlot')
    const host = document.getElementById('timerHostMobile')
    if (slot && host) host.appendChild(slot)
  }
  timerHost = document.getElementById('timerHost')
  renderSoundChips()
  renderTimer()
}

function methodChipsHTML() {
  const chips = METHODS.map(m =>
    `<button class="chip${m.key === focusCfg.key ? ' active' : ''}" onclick="window.setMethod('${m.key}')" title="${esc(m.benefit)}">${esc(m.name)}${m.rhythm === m.name ? '' : ` <span class="chip-rhythm">${esc(m.rhythm)}</span>`}</button>`
  ).join('')
  return `<div class="chip-row method-chips">${chips}</div><div class="method-benefit">${esc(focusCfg.benefit)}</div>`
}

// Idle shows a single "+". Type a label, press Enter, it runs.
function renderTimer() {
  if (!timerHost) timerHost = document.getElementById(IS_PHONE ? 'timerHostMobile' : 'timerHost')
  if (!timerHost) return

  if (composing) {
    timerHost.innerHTML = methodChipsHTML() +
      `<div class="timer-wrap idle">
        <input class="input-field timer-input" id="sessionInput" placeholder="What are you working on?" autocomplete="off">
        <div class="timer-note">Enter to start · Esc to cancel</div>
      </div>`
    const input = document.getElementById('sessionInput')
    input.focus()
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); startSession(input.value.trim()) }
      if (e.key === 'Escape') { composing = false; renderTimer() }
    }
    return
  }

  if (!timerRunning) {
    timerHost.innerHTML = methodChipsHTML() +
      `<div class="timer-wrap idle">
        <button class="timer-plus" onclick="window.beginCompose()" aria-label="Start a session">+</button>
        <div class="timer-note">Name what you're doing, press Enter, and it runs.</div>
      </div>`
    return
  }

  const countUp = isCountUp(focusCfg) && timerPhase === 'focus'
  const filled = roundsDone % focusCfg.rounds || (roundsDone ? focusCfg.rounds : 0)
  const dots = Array.from({ length: focusCfg.rounds },
    (_, i) => `<span class="round-dot${i < filled ? ' on' : ''}"></span>`).join('')
  const skip = countUp ? '' : `<button class="btn-ghost timer-side" onclick="window.skipPhase()">SKIP</button>`
  timerHost.innerHTML = methodChipsHTML() +
    `<div class="timer-wrap${timerPhase !== 'focus' ? ' is-break' : ''}">
      <div class="timer-phase">${phaseLabel(timerPhase)}</div>
      <div class="timer-label">${esc(sessionLabel || 'Session')}</div>
      <div class="timer-clock">${fmtClock(countUp ? timerElapsed : timerLeft)}</div>
      <div class="timer-rounds">${dots}</div>
      <div class="timer-controls">
        <button class="btn-primary timer-main" onclick="window.stopSession()">STOP</button>
        ${skip}
      </div>
      <div class="timer-note">Stopping writes it into today's journal.</div>
    </div>`
}

function beginCompose() { composing = true; renderTimer() }

function startSession(label) {
  if (!label) return
  sessionLabel = label
  composing = false
  timerPhase = 'focus'
  roundsDone = 0
  timerElapsed = 0
  timerLeft = phaseMinutes('focus', focusCfg) * 60
  timerRunning = true
  timerStartedAt = Date.now()
  timerEndsAt = Date.now() + timerLeft * 1000
  // wall-clock based, so a throttled tab cannot drift
  timerHandle = setInterval(tickTimer, 250)
  renderTimer()
  resumeBackgroundSound()
}

function tickTimer() {
  if (isCountUp(focusCfg) && timerPhase === 'focus') {
    timerElapsed = (Date.now() - timerStartedAt) / 1000
    renderTimer()
    return
  }
  timerLeft = Math.max(0, (timerEndsAt - Date.now()) / 1000)
  if (timerLeft <= 0) completePhase()
  else renderTimer()
}

// Closing the session logs it and brings the "+" back.
async function stopSession() {
  const minutes = Math.max(1, Math.round((Date.now() - timerStartedAt) / 60000))
  const label = sessionLabel
  clearInterval(timerHandle); timerHandle = null
  timerRunning = false
  composing = false
  timerPhase = 'focus'
  roundsDone = 0
  timerElapsed = 0
  timerLeft = phaseMinutes('focus', focusCfg) * 60
  hideBreakReview()
  renderTimer()
  try {
    await addEntry(toISODate(new Date()), 'note', `Focused ${minutes}m on ${label}`)
    await loadJournal()
    flashToast(`Logged ${minutes}m`)
  } catch (e) { console.warn('log session:', e) }
}

async function completePhase() {
  clearInterval(timerHandle); timerHandle = null
  const finished = timerPhase
  sendNotification(
    finished === 'focus' ? 'Time for a break' : 'Break over',
    finished === 'focus' ? `${sessionLabel} — ${phaseMinutes('focus', focusCfg)}m done.` : `Back to ${sessionLabel}.`
  )
  const nx = nextPhase(finished, roundsDone, focusCfg)
  timerPhase = nx.phase
  roundsDone = nx.roundsDone
  timerLeft = phaseMinutes(timerPhase, focusCfg) * 60
  timerEndsAt = Date.now() + timerLeft * 1000
  timerHandle = setInterval(tickTimer, 250)
  renderTimer()
  timerPhase === 'focus' ? hideBreakReview() : showBreakReview()
}

function skipPhase() { completePhase() }

async function setMethod(key) {
  focusCfg = methodByKey(key)
  await setSetting('focus_method', key)
  if (!timerRunning) timerLeft = phaseMinutes(timerPhase, focusCfg) * 60
  renderTimer()
}

// ─── break review ────────────────────────────────────────────
// Filler for a break you were taking anyway. No counts, no streaks,
// no backlog — missing a week costs nothing.
async function showBreakReview() {
  const host = document.getElementById('breakReview')
  if (!host) return
  try { wantList = await listWant() } catch {}
  const nudges = buildNudges(wantList, 2)
  const rows = nudges.map(n =>
    `<div class="j-row"><div class="j-text">
       <div class="j-title">${esc(n.title)}</div>
       <div class="j-meta">${esc(n.note)}</div>
     </div>${n.url ? `<button class="j-act" onclick="window.openExternal('${esc(n.url)}')" aria-label="Open summary">↗</button>` : ''}</div>`
  ).join('')
  // Guided sessions are offered, never forced — and only ones that fit.
  const mins = phaseMinutes(timerPhase, focusCfg)
  // parse once — indexOf below compares identity, so two parses would never match
  const all = parseSounds(soundsText)
  const fits = breakSoundsFor(all, mins)
  const tooLong = all.filter(x => x.role === 'break' && x.minutes && x.minutes > mins).length
  const soundRow = fits.length
    ? `<div class="break-sounds">${fits.map(x =>
        `<button class="chip" onclick="window.playSound(${all.indexOf(x)})">${esc(x.name)}${x.minutes ? `<span class="chip-rhythm">${x.minutes}m</span>` : ''}</button>`
      ).join('')}</div>`
    : tooLong
      ? `<div class="break-sounds"><span class="composer-hint">Your break sessions need a longer break than ${mins}m.</span></div>`
      : ''

  host.innerHTML = `<div class="j-section-label">WHILE YOU BREAK</div>` + soundRow + (rows ||
    `<div class="feed-status">Nothing on your reading list yet. Save a book from the Library and it turns up here.</div>`)
  host.style.display = 'block'
}

function hideBreakReview() {
  const host = document.getElementById('breakReview')
  if (host) host.style.display = 'none'
}

// ─── focus sounds ────────────────────────────────────────────
function renderSoundChips() {
  const host = document.getElementById('soundChips')
  if (!host) return
  const list = parseSounds(soundsText)
  const chips = list
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.role !== 'night')      // nightly ritual has its own card
    .map(({ s, i }) =>
      `<button class="chip${i === lastLoopIndex ? ' active' : ''}" onclick="window.playSound(${i})">${esc(s.name)}${s.role === 'break' ? `<span class="chip-rhythm">${s.minutes ? `${s.minutes}m` : 'session'}</span>` : ''}</button>`
    ).join('')
  host.innerHTML = chips ||
    `<span class="composer-hint">No sounds yet — tap the gear to add YouTube links.</span>`
  renderNightCard()
}

// A once-a-night ritual: no timer, no time gate. It sits there until you
// play it, then rests until tomorrow.
async function renderNightCard() {
  const host = document.getElementById('nightCard')
  if (!host) return
  const list = parseSounds(soundsText)
  const nights = list.map((s, i) => ({ s, i })).filter(({ s }) => s.role === 'night')
  if (!nights.length) { host.style.display = 'none'; return }
  const today = toISODate(new Date())
  const done = (await getSetting('night_done')) === today
  host.innerHTML = `<div class="j-section-label">TONIGHT</div>` + nights.map(({ s, i }) => `
    <div class="j-row night-row${done ? ' done' : ''}">
      <button class="j-check" onclick="window.toggleNightDone()" aria-label="${done ? 'Mark not done' : 'Mark done'}">
        ${done ? '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>
      <div class="j-text">
        <div class="j-title">${esc(s.name)}</div>
        <div class="j-meta">${done ? 'done tonight' : s.minutes ? `${s.minutes} minutes` : 'once a night'}</div>
      </div>
      <button class="j-act" onclick="window.playNight(${i})" aria-label="Play">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
      </button>
    </div>`).join('')
  host.style.display = 'block'
}

// Playing it counts as doing it.
async function playNight(i) {
  playSound(i)
  await setSetting('night_done', toISODate(new Date()))
  renderNightCard()
}

async function toggleNightDone() {
  const today = toISODate(new Date())
  const done = (await getSetting('night_done')) === today
  await setSetting('night_done', done ? '' : today)
  renderNightCard()
}

function playSound(i) {
  const list = parseSounds(soundsText)
  const s = list[i]
  if (!s) return
  if (s.role === 'loop') {
    lastLoopIndex = i
    setSetting('last_sound', String(i)).catch(() => {})
  }
  // A guided session must not repeat; background must.
  const repeat = s.role === 'loop' ? `&loop=1&playlist=${encodeURIComponent(s.id)}` : ''
  document.getElementById('soundDockName').textContent = s.name
  // Official IFrame embed kept visible at >=200x200, per YouTube policy.
  document.getElementById('soundPlayer').innerHTML =
    `<iframe width="280" height="200" src="https://www.youtube.com/embed/${encodeURIComponent(s.id)}?autoplay=1${repeat}" title="${esc(s.name)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
  document.getElementById('soundDock').style.display = 'block'
  renderSoundChips()
}

// Pressing "+" resumes whatever background sound you last chose.
function resumeBackgroundSound() {
  const list = parseSounds(soundsText)
  const i = lastLoopIndex >= 0 && list[lastLoopIndex]?.role === 'loop'
    ? lastLoopIndex
    : list.findIndex(s => s.role === 'loop')
  if (i >= 0) playSound(i)
}

function stopSound() {
  document.getElementById('soundPlayer').innerHTML = ''
  document.getElementById('soundDock').style.display = 'none'
}

async function toggleFocusSettings() {
  const sheet = document.getElementById('focusSettings')
  if (sheet.style.display === 'none') {
    document.getElementById('soundsText').value = soundsText
    sheet.style.display = 'flex'
  } else sheet.style.display = 'none'
}

async function saveFocusSettings() {
  soundsText = document.getElementById('soundsText').value
  await setSetting('focus_sounds', soundsText)
  document.getElementById('focusSettings').style.display = 'none'
  renderSoundChips()
  flashToast('Saved')
}

async function openExternal(url) {
  try {
    const mod = await import('@tauri-apps/plugin-opener')
    await mod.openUrl(url)
  } catch { window.open(url, '_blank') }
}

// ═════════════════════════════════════════════════════════════
//  LIBRARY  (books as markdown; persuasion, not storage)
// ═════════════════════════════════════════════════════════════
async function loadLibrary() {
  try { wantList = await listWant() } catch (e) { wantList = []; console.warn('reading list:', e) }
  renderLibrary()
}

function setLibraryView(view) {
  libraryView = view
  document.querySelectorAll('#libraryChips .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.lib === view))
  renderLibrary()
}

function renderLibrary() {
  const host = document.getElementById('libraryBody')
  if (!host) return

  if (libraryView === 'list') {
    host.innerHTML = wantList.length
      ? wantList.map(b => `
          <div class="j-row j-task ${b.done ? 'done' : ''}">
            <button class="j-check" onclick="window.wantToggle('${esc(b.title)}')" aria-label="Mark read">
              ${b.done ? '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </button>
            <div class="j-text">
              <div class="j-title">${esc(b.title)}</div>
              <div class="j-meta">${b.added ? `saved ${esc(b.added)}` : 'on your list'}</div>
            </div>
            ${b.url ? `<button class="j-act" onclick="window.openExternal('${esc(b.url)}')" aria-label="Open summary">↗</button>` : ''}
            <button class="j-act j-del" onclick="window.wantRemove('${esc(b.title)}')" aria-label="Remove">✕</button>
          </div>`).join('')
      : `<div class="feed-status">Nothing saved yet.<br><span style="font-size:10px">Tap <b>Want to read</b> on any idea card and the book lands here — and turns up during your breaks.</span></div>`
    return
  }

  const ideas = feedItems.filter(i => i.kind === 'idea')
  if (!ideas.length) {
    host.innerHTML = `<div class="feed-status">No book ideas yet. Tap refresh to pull some in.</div>`
    return
  }
  host.innerHTML = `<div class="feed-grid">${ideas.map(cardHTML).join('')}</div>` +
    `<div class="caught-up"><div class="caught-up-title">That's the batch</div>
     <div class="caught-up-sub">${ideas.length} ideas from ${new Set(ideas.map(i => i.book)).size} books.</div></div>`
}

// Saving an idea writes it to the vault; saving its book adds a name to the list.
async function saveIdeaCard(id) {
  const it = feedItemById.get(id)
  if (!it) return
  try { await saveIdea(it); flashToast('Idea saved to vault') }
  catch (e) { console.warn('save idea:', e); flashToast('Save failed') }
}

async function wantBook(id) {
  const it = feedItemById.get(id)
  if (!it) return
  try {
    const added = await addWant(it.book || it.title, it.url)
    flashToast(added ? `“${it.book || it.title}” added` : 'Already on your list')
    wantList = await listWant()
  } catch (e) { console.warn('want:', e); flashToast('Save failed') }
}

async function wantToggle(title) {
  await toggleWant(title)
  wantList = await listWant()
  renderLibrary()
}

async function wantRemove(title) {
  await removeWant(title)
  wantList = await listWant()
  renderLibrary()
}

// ═════════════════════════════════════════════════════════════
//  JOURNAL  (bullet journal: events + tasks + notes per day)
// ═════════════════════════════════════════════════════════════
async function loadJournal() {
  try {
    calendarItems = await getSchedule()
  } catch (e) {
    calendarItems = []
    console.warn('loadJournal schedule:', e.message || e)
  }
  try {
    journalEntries = await loadDay(toISODate(calendarSelected))
  } catch (e) {
    journalEntries = []
    console.warn('loadJournal md:', e.message || e)
  }
  renderMiniMonth()
  renderDayLog()
  updateDateLabel()
}

function updateDateLabel() {
  const el = document.getElementById('selectedDateLabel')
  if (!el) return
  const d = calendarSelected
  const isToday = toISODate(d) === toISODate(new Date())
  const names = ['SUN','MON','TUE','WED','THU','FRI','SAT']
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  el.textContent = `${names[d.getDay()]} · ${monthNames[d.getMonth()]} ${d.getDate()}${isToday ? ' · TODAY' : ''}`
}

// ─── DAY LOG ────────────────────────────────────────────────
const BULLET = {
  event: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>`,
  note:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  migrated: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  check: `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  skip:  `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  del:   `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
}

function eventRowHTML(it) {
  const startMin = minutesFromTime(it.time_start)
  const end = timeFromMinutes(startMin + (it.duration_minutes || 30))
  const recur = it.recurrence_rule && it.recurrence_rule !== 'once' ? ` · ${recurrenceLabel(it.recurrence_rule)}` : ''
  const notify = it.notify_minutes ? ` · ⏰${it.notify_minutes}m` : ''
  return `
    <div class="j-row j-event">
      <span class="j-bullet j-bullet-event">${BULLET.event}</span>
      <span class="j-time-chip">${esc(it.time_start || '')}</span>
      <div class="j-text">
        <div class="j-title">${esc(it.name)}</div>
        <div class="j-meta">until ${esc(end)}${recur}${notify}</div>
      </div>
      <button class="j-act j-del" onclick="window.eventDelete('${it.id}')" aria-label="Delete event">${BULLET.del}</button>
    </div>`
}

function taskRowHTML(e) {
  const iso = toISODate(calendarSelected)
  if (e.type === 'note') {
    return `
      <div class="j-row j-note">
        <span class="j-bullet">${BULLET.note}</span>
        <div class="j-text"><div class="j-title">${esc(e.text)}</div></div>
        <button class="j-act j-del" onclick="window.journalDelete(${e.lineIdx})" aria-label="Delete note">${BULLET.del}</button>
      </div>`
  }
  const done = e.state === 'done'
  const closed = e.state === 'migrated' || e.state === 'skipped'
  const stateLabel = e.state === 'migrated' ? `<span class="j-state-tag">${BULLET.migrated} moved to next day</span>`
                   : e.state === 'skipped'  ? `<span class="j-state-tag">skipped</span>` : ''
  return `
    <div class="j-row j-task ${e.state}">
      <button class="j-check" onclick="window.journalToggle(${e.lineIdx})" ${closed ? 'disabled' : ''}
              aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? BULLET.check : ''}</button>
      <div class="j-text">
        <div class="j-title">${esc(e.text)}</div>
        ${stateLabel}
      </div>
      ${e.state === 'open' ? `
        <button class="j-act" onclick="window.journalMigrate(${e.lineIdx})" title="Move to tomorrow" aria-label="Move task to tomorrow">${BULLET.migrated}</button>
        <button class="j-act" onclick="window.journalSkip(${e.lineIdx})" title="Skip" aria-label="Skip task">${BULLET.skip}</button>` : ''}
      <button class="j-act j-del" onclick="window.journalDelete(${e.lineIdx})" aria-label="Delete task">${BULLET.del}</button>
    </div>`
}

function renderDayLog() {
  const host = document.getElementById('dayLog')
  if (!host) return
  const events = itemsForDate(calendarItems, calendarSelected)
    .sort((a, b) => minutesFromTime(a.time_start) - minutesFromTime(b.time_start))
  const tasks = journalEntries.filter(e => e.type === 'task' && e.state === 'open')
  const notes = journalEntries.filter(e => e.type === 'note')
  const closed = journalEntries.filter(e => e.type === 'task' && e.state !== 'open')

  let html = ''
  if (events.length) html += `<div class="j-section-label">SCHEDULE</div>` + events.map(eventRowHTML).join('')
  if (tasks.length)  html += `<div class="j-section-label">TASKS</div>` + tasks.map(taskRowHTML).join('')
  if (notes.length)  html += `<div class="j-section-label">NOTES</div>` + notes.map(taskRowHTML).join('')
  if (closed.length) html += `<div class="j-section-label">LOGGED</div>` + closed.map(taskRowHTML).join('')

  if (!html) {
    html = `<div class="feed-status">Empty day. Add a task, note, or timed event below.<br><span style="font-size:10px">Tasks &amp; notes land in Documents/ZyneVault/journal/ as markdown — Obsidian-ready.</span></div>`
  }
  host.innerHTML = html
}

// ─── COMPOSER ───────────────────────────────────────────────
function setEntryType(type) {
  entryType = type
  document.querySelectorAll('.composer-chips .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.etype === type))
  document.getElementById('eventFields').style.display = type === 'event' ? 'grid' : 'none'
  const input = document.getElementById('entryInput')
  input.placeholder = type === 'task' ? 'Add a task…' : type === 'note' ? 'Add a note…' : 'Event name…'
  document.getElementById('composerHint').textContent =
    type === 'event' ? 'saved to schedule + reminders' : 'saved to journal md'
  input.focus()
}

async function submitEntry() {
  const input = document.getElementById('entryInput')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  const iso = toISODate(calendarSelected)
  try {
    if (entryType === 'event') {
      const recurrence = val('schedRecur') || 'once'
      await saveScheduleItem({
        name: text,
        time_start: val('schedTime') || '09:00',
        duration_minutes: parseInt(val('schedDur')) || 30,
        category: 'task',
        date: recurrence === 'once' ? iso : null,
        recurrence_rule: recurrence,
        notify_minutes: parseInt(val('schedNotify')) || 0,
        notes: '',
      })
    } else {
      await addEntry(iso, entryType, text)
    }
  } catch (e) { console.warn(e); flashToast('Save failed') }
  await loadJournal()
}

// ─── TASK ACTIONS ───────────────────────────────────────────
const isoSelected = () => toISODate(calendarSelected)
const isoNextDay = () => {
  const d = new Date(calendarSelected)
  d.setDate(d.getDate() + 1)
  return toISODate(d)
}

async function journalToggle(lineIdx) {
  const e = journalEntries.find(x => x.lineIdx === lineIdx)
  if (!e) return
  try { await setTaskState(isoSelected(), lineIdx, e.state === 'done' ? 'open' : 'done') } catch (err) { console.warn(err) }
  await loadJournal()
}

async function journalMigrate(lineIdx) {
  try { await setTaskState(isoSelected(), lineIdx, 'migrated', isoNextDay()) } catch (err) { console.warn(err) }
  flashToast('Moved to next day')
  await loadJournal()
}

async function journalSkip(lineIdx) {
  try { await setTaskState(isoSelected(), lineIdx, 'skipped') } catch (err) { console.warn(err) }
  await loadJournal()
}

async function journalDelete(lineIdx) {
  try { await deleteEntry(isoSelected(), lineIdx) } catch (err) { console.warn(err) }
  await loadJournal()
}

async function eventDelete(id) {
  try { await deleteScheduleItem(id) } catch (e) { console.warn(e) }
  await loadJournal()
}

// ─── MINI MONTH ─────────────────────────────────────────────
function renderMiniMonth() {
  const host = document.getElementById('miniMonth')
  if (!host) return
  const anchor = calendarAnchor
  const selISO = toISODate(calendarSelected)
  const todayISO = toISODate(new Date())
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const weekdayNames = ['S','M','T','W','T','F','S']

  const busy = new Set()
  for (const it of calendarItems) {
    if ((it.recurrence_rule || 'once') === 'once' && it.date) busy.add(it.date)
  }
  const cells = buildMonthGrid(anchor)
  for (const c of cells) {
    for (const it of calendarItems) {
      if (!it.recurrence_rule || it.recurrence_rule === 'once') continue
      if (itemsForDate([it], c.date).length) { busy.add(c.iso); break }
    }
  }

  const cellsHTML = cells.map(c => {
    const classes = ['mm-cell']
    if (!c.inMonth) classes.push('other-month')
    if (c.iso === todayISO) classes.push('today')
    if (c.iso === selISO) classes.push('selected')
    return `
      <div class="${classes.join(' ')}" data-iso="${c.iso}" onclick="window.selectCalendarDate('${c.iso}')">
        ${c.date.getDate()}
        ${busy.has(c.iso) ? '<div class="mm-dot"></div>' : ''}
      </div>`
  }).join('')

  host.innerHTML = `
    <div class="mini-month">
      <div class="mm-nav">
        <button class="mm-nav-btn" onclick="window.monthStep(-1)">‹ PREV</button>
        <div class="mm-month-label">${monthNames[anchor.getMonth()]} ${anchor.getFullYear()}</div>
        <button class="mm-nav-btn" onclick="window.monthStep(1)">NEXT ›</button>
      </div>
      <div class="mm-grid">
        ${weekdayNames.map(w => `<div class="mm-weekday">${w}</div>`).join('')}
        ${cellsHTML}
      </div>
      <div style="text-align:center;margin-top:6px">
        <button class="mm-nav-btn" onclick="window.jumpToToday()">● TODAY</button>
      </div>
    </div>`
}

function monthStep(delta) {
  calendarAnchor = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + delta, 1)
  renderMiniMonth()
}

function jumpToToday() {
  const today = new Date()
  calendarAnchor = new Date(today.getFullYear(), today.getMonth(), 1)
  calendarSelected = today
  loadJournal()
}

function selectCalendarDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  calendarSelected = new Date(y, m - 1, d)
  if (calendarSelected.getMonth() !== calendarAnchor.getMonth() ||
      calendarSelected.getFullYear() !== calendarAnchor.getFullYear()) {
    calendarAnchor = new Date(calendarSelected.getFullYear(), calendarSelected.getMonth(), 1)
  }
  loadJournal()
}

// ─── REMINDERS (Tauri notifications) ────────────────────────
async function sendNotification(title, body) {
  try {
    const mod = await import('@tauri-apps/plugin-notification')
    let granted = await mod.isPermissionGranted()
    if (!granted) granted = (await mod.requestPermission()) === 'granted'
    if (granted) mod.sendNotification({ title, body })
    else console.log('[notify]', title, '—', body)
  } catch (e) {
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') new Notification(title, { body })
        else if (Notification.permission !== 'denied') {
          const p = await Notification.requestPermission()
          if (p === 'granted') new Notification(title, { body })
        }
      } else {
        console.log('[notify]', title, '—', body)
      }
    } catch { console.log('[notify]', title, '—', body) }
  }
}

function checkUpcomingReminders() {
  const now = new Date()
  const todaysItems = itemsForDate(calendarItems, now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  for (const it of todaysItems) {
    const notify = it.notify_minutes || 0
    if (!notify) continue
    const startMin = minutesFromTime(it.time_start)
    const triggerMin = startMin - notify
    if (nowMin >= triggerMin && nowMin < triggerMin + 1) {
      const key = `${toISODate(now)}|${it.id}|${triggerMin}`
      if (notifiedItemKeys.has(key)) continue
      notifiedItemKeys.add(key)
      sendNotification(
        `⌁ ${it.name}`,
        `Starts at ${it.time_start}${notify ? ` · in ${notify} min` : ''}`
      )
    }
  }
}

function startReminderLoop() {
  if (notifyTimer) return
  notifyTimer = setInterval(checkUpcomingReminders, 30_000)
  setTimeout(checkUpcomingReminders, 3_000)
}

// ═════════════════════════════════════════════════════════════
//  INPUT BINDINGS
// ═════════════════════════════════════════════════════════════
function bindInputs() {
  const t = document.getElementById('entryInput')
  if (t) t.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitEntry() }
  })
  // Physical keyboard for the PIN screen (desktop convenience)
  document.addEventListener('keydown', e => {
    if (!document.getElementById('pinLock')) return
    if (/^[0-9]$/.test(e.key)) pinPress(e.key)
    if (e.key === 'Backspace') pinBack()
  })
}

// ─── SMALL UTILS ─────────────────────────────────────────────
function val(id)         { return document.getElementById(id)?.value || '' }
function setVal(id, v)   { const el = document.getElementById(id); if (el) el.value = v }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]))
}

// ═════════════════════════════════════════════════════════════
//  EXPOSE FOR INLINE onclick=  in index.html
// ═════════════════════════════════════════════════════════════
Object.assign(window, {
  switchPage,
  // PIN
  pinPress, pinBack,
  // Feed
  refreshFeed, openFeedItem, clipFeedItem, clearFeedBatch,
  setKindFilter, toggleSettings, saveSettings,
  // Focus
  beginCompose, startSession, stopSession, skipPhase, setMethod,
  toggleFocusSettings, saveFocusSettings,
  playSound, stopSound, openExternal, playNight, toggleNightDone,
  // Library
  setLibraryView, saveIdeaCard, wantBook, wantToggle, wantRemove,
  __reloadLibrary: loadLibrary,   // used by the browser-dev self-check
  // Journal
  setEntryType, submitEntry,
  journalToggle, journalMigrate, journalSkip, journalDelete, eventDelete,
  selectCalendarDate, monthStep, jumpToToday,
})
