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

import { DEFAULT_SOURCES, SOURCES_SEED_VERSION, SHOWCASE_SOURCES, parseSources, showcaseNames, fetchAllSources, interleaveBySource, withTimeout } from './feed.js'
import { loadDay, addEntry, setTaskState, deleteEntry, clipItem } from './journal.js'
import { DEFAULT_PROFILE, rankItems, scoreLocally } from './ranker.js'
import {
  METHODS, methodByKey, isCountUp, DEFAULT_SOUNDS, nextPhase, phaseLabel,
  phaseMinutes, fmtClock, parseSounds, breakSoundsFor,
} from './focus.js'
import { listWant, addWant, toggleWant, removeWant, saveIdea, buildNudges } from './library.js'
import { CARDS, drawIndex, randomLine } from './tarot.js'
import { openCardStage, closeCardStage } from './card3d.js'
import { invoke } from '@tauri-apps/api/core'
import { native, initStore, snapshot, chooseFile, saveFile } from './companion-store.js'
import {
  setSyncStatus, beginHosting, endHosting, connectAndSync,
  exportBackup, importBackup, resolveConflict,
} from './companion-sync.js'
import { chatWindow } from './companion-model.js'
import { buildContext, parseSuggestion, dueNudge, buildLensContext, parseLens, localLens } from './coach.js'

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
  await loadMoods()
  // A damaged sync index must not stop the app; sync just reports it.
  try { await initStore() } catch (e) { console.warn('companion store:', e) }
  setSyncStatus(msg => { setStatus('syncStatus', msg); flashToast(msg) })
  window.addEventListener('zyne-sync-complete', async () => {
    await loadJournal()
    if (!IS_PHONE) await loadLibrary()
    renderConflicts()
  })

  // The timer lives on both platforms; only its host differs.
  await loadFocusSettings()

  try { await getSourcesText() } catch {}       // fills showcaseSet for the chip
  await renderFeedFromDb()
  if (IS_PHONE) {
    moveNavDrop()
    window.addEventListener('resize', () => moveNavDrop())
    refreshFeed()                 // phone reads the news feed, so fetch everything
  } else {
    switchPage('focus')           // laptop opens on work, not browsing
    await loadLibrary()
    refreshFeed({ booksOnly: true })   // only book sources matter here
  }

  await loadJournal()
  startReminderLoop()
  await renderAiPanel()
  renderNextCard()
}

let clockDay = ''
function updateClock() {
  const now = new Date()
  const s = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const el = document.getElementById('clockDisplay')
  if (el) el.textContent = s
  // left open past midnight: yesterday's card must go face-down again
  const iso = toISODate(now)
  if (clockDay && clockDay !== iso) { closeCardStage(); renderDailyCard() }
  clockDay = iso
}

// ═════════════════════════════════════════════════════════════
//  PAGE NAVIGATION
// ═════════════════════════════════════════════════════════════
function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('page-' + page)?.classList.add('active')
  document.getElementById('nav-'  + page)?.classList.add('active')
  if (page === 'companion') renderConflicts()
  moveNavDrop(true)
}

// Phone: a glass droplet slides under the active nav item (glass.css).
function moveNavDrop(animate = false) {
  if (!IS_PHONE) return
  const nav = document.querySelector('.bottom-nav')
  const item = nav?.querySelector('.nav-item.active')
  if (!nav || !item) return
  let drop = nav.querySelector('.nav-drop')
  if (!drop) { drop = document.createElement('span'); drop.className = 'nav-drop'; nav.prepend(drop) }
  const n = nav.getBoundingClientRect(), r = item.getBoundingClientRect()
  if (!animate) drop.style.transition = 'none'
  drop.style.left = `${r.left - n.left}px`
  drop.style.width = `${r.width}px`
  if (!animate) { void drop.offsetWidth; drop.style.transition = '' ; return }
  drop.classList.remove('moving'); void drop.offsetWidth; drop.classList.add('moving')
}

// ═════════════════════════════════════════════════════════════
//  FEED
// ═════════════════════════════════════════════════════════════
async function getSourcesText() {
  let text = await getSetting('sources')
  const seedV = (await getSetting('sources_seed_v')) || '1'
  if (text && seedV === '3') {
    // v4 only adds Showcase; keep whatever the user changed and append it
    if (!/showcase/i.test(text)) text = `${text.replace(/\s*$/, '')}\n${SHOWCASE_SOURCES}\n`
    await setSetting('sources', text)
    await setSetting('sources_seed_v', SOURCES_SEED_VERSION)
  } else if (!text || seedV < SOURCES_SEED_VERSION) {
    text = DEFAULT_SOURCES
    await setSetting('sources', text)
    await setSetting('sources_seed_v', SOURCES_SEED_VERSION)
  }
  showcaseSet = showcaseNames(parseSources(text))
  return text
}
let showcaseSet = new Set()

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
    btn?.classList.remove('spinning')   // the new items are on screen; ranking is a quiet extra
    // one cheap Haiku call if a key is set, never allowed to hang
    await withTimeout(rankNewItems(), 30_000, 'ranking').catch(e => console.warn('rank:', e.message))
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
    : kindFilter === 'showcase' ? feedItems.filter(i => showcaseSet.has(i.source))
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

// ─── settings panel ─────────────────────────────────────────
// Its own full panel: a short list first, then one section at a time,
// so text boxes only appear inside the section they belong to.
const SP_TITLES = { home: 'Settings', sources: 'Sources', interests: 'Interests', ranking: 'Smart ranking', sounds: 'Focus sounds' }
let spView = 'home'

async function openSettings(view = 'home') {
  const panel = document.getElementById('settingsPanel')
  if (!panel) return
  spView = view
  if (view === 'home') await fillSettingsSummary()
  if (view === 'sources') document.getElementById('sourcesText').value = await getSourcesText()
  if (view === 'interests') document.getElementById('profileText').value = (await getSetting('interest_profile')) || DEFAULT_PROFILE
  if (view === 'ranking') document.getElementById('apiKeyInput').value = (await getSetting('anthropic_key')) || ''
  if (view === 'sounds') document.getElementById('soundsText').value = soundsText
  panel.querySelectorAll('.sp-view').forEach(v => { v.hidden = v.dataset.view !== view })
  document.getElementById('spTitle').textContent = SP_TITLES[view] || 'Settings'
  document.getElementById('spBack').style.visibility = view === 'home' ? 'hidden' : ''
  document.getElementById('spFoot').hidden = view === 'home'
  panel.querySelector('.sp-body').scrollTop = 0
  if (panel.hidden) {
    panel.hidden = false
    requestAnimationFrame(() => panel.classList.add('open'))
  }
}

async function fillSettingsSummary() {
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t }
  try {
    const n = parseSources(await getSourcesText()).length
    set('spSourcesSub', `${n} sources, including Showcase`)
  } catch {}
  set('spRankingSub', (await getSetting('anthropic_key')) ? 'On: Claude ranks the feed' : 'Off: free local ranking')
  const sounds = parseSounds(soundsText).length
  set('spSoundsSub', sounds ? `${sounds} sound${sounds > 1 ? 's' : ''}` : 'None yet: add YouTube links')
}

function settingsBack() { spView === 'home' ? closeSettings() : openSettings('home') }

function closeSettings() {
  const panel = document.getElementById('settingsPanel')
  if (!panel || panel.hidden) return
  panel.classList.remove('open')
  setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true }, 260)
}

async function saveSettingsView() {
  const v = id => document.getElementById(id).value
  if (spView === 'sources') {
    await setSetting('sources', v('sourcesText'))
    showcaseSet = showcaseNames(parseSources(v('sourcesText')))
    refreshFeed(IS_PHONE ? {} : { booksOnly: true })
  }
  if (spView === 'interests') await setSetting('interest_profile', v('profileText'))
  if (spView === 'ranking') await setSetting('anthropic_key', v('apiKeyInput').trim())
  if (spView === 'sounds') {
    soundsText = v('soundsText')
    await setSetting('focus_sounds', soundsText)
    renderSoundChips()
    renderNightCard()
  }
  flashToast('Saved')
  openSettings('home')
}

// old entry points, kept for the existing buttons
const toggleSettings = () => openSettings('home')
const toggleFocusSettings = () => openSettings('sounds')

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('settingsPanel')?.hidden) settingsBack()
})

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
  renderDailyCard()
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
        <div class="timer-idle-title">What would you like to focus on?</div>
        <div class="timer-note">Choose one thing. Tap + to begin.</div>
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
  renderNextCard()
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
  suggestion = null
  renderNextCard()
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

// ─── daily card ──────────────────────────────────────────────
// One card a day. It starts face down — the draw is the point — and
// stays until tomorrow. A line to sit with rides alongside.
let todayLine = randomLine()

// Drawn marks, not geometry: branch · vessel · feather · seed · moon.
const SUIT_MARK = {
  wands:     '<path d="M20 35V13M20 20c-5-1-8-5-8-10 5 0 8 3 9 7M20 24c5-1 9-4 10-10-6 0-9 3-10 7"/>',
  cups:      '<path d="M11 11h18l-2 11a7 7 0 0 1-14 0L11 11ZM20 29v6M14 35h12"/>',
  swords:    '<path d="M20 5c5 7 6 15 3 22l-3 8-3-8c-3-7-2-15 3-22ZM20 9v20"/>',
  pentacles: '<path d="M20 7c7 4 11 9 11 15a11 11 0 0 1-22 0c0-6 4-11 11-15ZM20 14v12"/>',
  major:     '<path d="M25.5 6.5a11 11 0 1 0 8.2 16.6A12.5 12.5 0 0 1 25.5 6.5Z"/><path d="M9 9.5l1.1 2.6 2.6 1.1-2.6 1.1L9 16.9l-1.1-2.6L5.3 13.2l2.6-1.1L9 9.5Z"/>',
  back:      '<circle cx="20" cy="20" r="9"/><path d="M20 4v5M20 31v5M4 20h5M31 20h5"/>',
}
const suitSvg = (suit, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" stroke="currentColor"
     stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SUIT_MARK[suit] || SUIT_MARK.major}</svg>`

// Pip cards: the count is a loop, never a drawing that has to be trusted.
// Columns per rank — 4 as a square, 9 as three rows of three, 10 as two of
// five, the way pip cards have always been laid out.
const PIP_COLS = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 3, 8: 4, 9: 3, 10: 5 }
const pipSize = (rank, base) =>
  Math.round(base * (rank === 1 ? 0.78 : rank <= 3 ? 0.52 : rank <= 6 ? 0.40 : 0.32))

// The mark field: a pip grid for Ace–Ten, a single mark for everything else.
// `base` is the width the single mark would have taken.
function markField(card, base) {
  if (!card.rank) return suitSvg(card.suit, base)
  const size = pipSize(card.rank, base)
  const pips = Array.from({ length: card.rank }, (_, i) => {
    // deterministic tilt: the same card always sits the same way, but the
    // grid never reads as stamped
    const tilt = ((i * 37) % 11) - 5
    return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.3"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      style="width:${size}px;height:${size}px;transform:rotate(${tilt}deg)">${SUIT_MARK[card.suit]}</svg>`
  }).join('')
  return `<span class="pips" style="grid-template-columns:repeat(${PIP_COLS[card.rank]},auto)">${pips}</span>`
}

// ═════════════════════════════════════════════════════════════
//  MOOD
//  One tap a day. Words, not scores — a 1-to-5 rating invites you to
//  chase a higher number, and a mood is not a performance. The month
//  above tints itself so patterns show up without anyone counting
//  anything at you. No streaks, by the same rule as the reading nudges.
// ═════════════════════════════════════════════════════════════
const MOODS = [
  { key: 'rough',  label: 'Rough',  tone: 'var(--news)',    face: 'M14 25c1.6-2.2 3.6-3.3 6-3.3s4.4 1.1 6 3.3' },
  { key: 'low',    label: 'Low',    tone: 'var(--skeptic)', face: 'M14 24h12' },
  { key: 'okay',   label: 'Okay',   tone: 'var(--muted)',   face: 'M15 23.5c1.3.9 2.9 1.3 5 1.3s3.7-.4 5-1.3' },
  { key: 'good',   label: 'Good',   tone: 'var(--learn)',   face: 'M13.5 22c1.8 2.6 4 3.9 6.5 3.9s4.7-1.3 6.5-3.9' },
  { key: 'bright', label: 'Bright', tone: 'var(--pers)',    face: 'M13 21c1.2 3.6 3.6 5.4 7 5.4s5.8-1.8 7-5.4Z' },
]
let moodLog = {}                               // { '2026-10-20': 'good' }

async function loadMoods() {
  try { moodLog = JSON.parse((await getSetting('mood_log')) || '{}') } catch { moodLog = {} }
}

function renderMoodRow() {
  const host = document.getElementById('moodRow')
  if (!host) return
  const iso = toISODate(calendarSelected)
  const picked = moodLog[iso]
  host.innerHTML = `<div class="j-section-label">HOW IS IT GOING</div>
    <div class="mood-faces">${MOODS.map(m => `
      <button class="mood-face${picked === m.key ? ' on' : ''}" style="--tone:${m.tone}"
              onclick="window.setMood('${m.key}')"
              aria-pressed="${picked === m.key}" aria-label="${m.label}">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="20" cy="20" r="14"/><circle cx="15" cy="16.5" r=".9" fill="currentColor"/>
          <circle cx="25" cy="16.5" r=".9" fill="currentColor"/><path d="${m.face}"/>
        </svg>
        <span>${m.label}</span>
      </button>`).join('')}</div>`
}

// Tapping the mood you already picked clears it — a wrong tap should not
// be permanent, and nothing here is worth a confirm dialog.
async function setMood(key) {
  const iso = toISODate(calendarSelected)
  const was = moodLog[iso]
  if (was === key) delete moodLog[iso]; else moodLog[iso] = key
  await setSetting('mood_log', JSON.stringify(moodLog))
  renderMoodRow()
  renderMiniMonth()
  if (was === key) return
  try {
    await addEntry(iso, 'note', `Mood: ${MOODS.find(m => m.key === key).label.toLowerCase()}`)
    await loadJournal()
  } catch (e) { console.warn('log mood:', e) }
}

// Major arcana art, bundled and hashed by Vite. The filename is chosen at
// runtime from the card name, so it has to come through a glob rather than
// a plain import. A card with no file falls back to its drawn mark, which
// is how the courts and the un-illustrated cards still render.
const ART = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/tarot/*.jpg', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.split('/').pop().replace(/\.jpg$/, ''), url])
)
const artFor = name =>
  ART[name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]

// Phone only. The laptop is for working, so the card stays off it.
// In the Journal it is one compact row; tapping it opens the 3D stage
// (card3d.js), where you pick, flip and tilt the card.
const cardFace = card => {
  const art = artFor(card.name)
  return `
  ${card.numeral ? `<div class="tnum">${esc(card.numeral)}</div>` : ''}
  ${art
    ? `<span class="tart"><img src="${art}" alt="" draggable="false"></span>`
    : `<span class="tmark${card.rank ? ' has-pips' : ''}">${markField(card, 110)}</span>`}
  <div class="tname">${esc(card.name)}</div>
  ${art ? '' : `<div class="timg">${esc(card.image)}</div>`}
  <div class="tkeys">${esc(card.keys)}</div>`
}
const cardBack = () => `<span class="tmark">${suitSvg('back', 34)}</span>`
const lineHTML = () =>
  `${esc(todayLine.text)}${todayLine.who ? ` <span class="daily-who">${esc(todayLine.who)}</span>` : ''}`

async function todaysCard() {
  const [day, idx] = ((await getSetting('tarot_drawn')) || '').split('|')
  return day === toISODate(new Date()) ? CARDS[Number(idx)] || null : null
}

async function renderDailyCard() {
  const host = document.getElementById('dailyCard')
  if (!host) return
  if (!IS_PHONE) { host.style.display = 'none'; host.innerHTML = ''; return }
  host.style.display = ''
  const card = await todaysCard()
  host.innerHTML = `
    <div class="daily-mini">
      <button class="mini-card ${card ? 'up ' + esc(card.suit) : ''}" onclick="window.openDailyCard()"
              aria-label="${card ? `Open today's card, ${esc(card.name)}` : "Draw today's card"}">
        ${suitSvg(card ? card.suit : 'back', 22)}
      </button>
      <button class="mini-text" onclick="window.openDailyCard()">
        <span class="mini-eyebrow">TODAY’S CARD</span>
        <span class="mini-name">${card ? esc(card.name) : 'Tap to draw'}</span>
      </button>
      <button class="daily-line mini-line" onclick="window.shuffleLine()" aria-label="Another line">${lineHTML()}</button>
    </div>`
}

async function openDailyCard() {
  openCardStage({
    card: await todaysCard(),
    front: cardFace,
    back: cardBack(),
    line: lineHTML(),
    onDraw: drawDailyCard,
    extra: async card => lensHTML(await dailyLens(card)),
  })
}

// ─── daily lens: Mind · Heart · People + one if–then plan ───
// Gemini reads the card's theme against your real day when AI is on;
// otherwise the built-in principle for the suit. Cached for the day.
let todaysLens = null
async function dailyLens(card) {
  const today = toISODate(new Date())
  const [day, json] = splitOnce((await getSetting('tarot_lens')) || '', '|')
  if (day === today) { try { return (todaysLens = JSON.parse(json)) } catch {} }
  let lens = null
  if (aiOn()) {
    try { lens = parseLens(await invoke('ai_lens', { context: buildLensContext(card, await gatherContext()) })) }
    catch (e) { console.warn('lens:', errText(e)) }
  }
  lens = lens || localLens(card)
  todaysLens = lens
  if (lens.source === 'ai') await setSetting('tarot_lens', `${today}|${JSON.stringify(lens)}`)
  return lens
}
const splitOnce = (s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)] }

function lensHTML(l) {
  const row = (k, label, text) => `<div class="lens-row"><span class="lens-k ${k}">${label}</span><span>${esc(text)}</span></div>`
  return `
    <div class="lens">
      <div class="lens-head">TODAY’S LENS</div>
      ${row('mind', 'MIND', l.mind)}
      ${row('heart', 'HEART', l.heart)}
      ${row('people', 'PEOPLE', l.people)}
      <div class="lens-plan">
        <div class="lens-k plan">IF–THEN</div>
        <div class="lens-plan-text">${esc(l.ifThen)}</div>
        <button class="lens-keep" onclick="window.keepIfThen(this)">ADD TO TODAY</button>
      </div>
      ${l.source === 'local' ? '<div class="lens-src">Built-in. Turn on AI in Companion for one shaped around your day.</div>' : ''}
    </div>`
}

async function keepIfThen(btn) {
  if (!todaysLens?.ifThen) return
  await addEntry(toISODate(new Date()), 'task', todaysLens.ifThen)
  await loadJournal()
  if (btn) { btn.textContent = 'ADDED ✓'; btn.disabled = true }
}

// Drawing writes the card into today's journal, the way a finished
// session does — so the draws are a record, not a moment that vanishes.
async function drawDailyCard() {
  const today = toISODate(new Date())
  const existing = await todaysCard()
  if (existing) return existing                 // one draw a day
  const i = drawIndex()
  await setSetting('tarot_drawn', `${today}|${i}`)
  renderDailyCard()
  try {
    await addEntry(today, 'note', `Card: ${CARDS[i].name} — ${CARDS[i].keys}`)
    await loadJournal()
  } catch (e) { console.warn('log card:', e) }
  return CARDS[i]
}

function shuffleLine() { todayLine = randomLine(); renderDailyCard() }

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
  renderMoodRow()
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
    // a day you logged carries its mood as a wash behind the number
    const mood = moodLog[c.iso]
    if (mood) classes.push('has-mood')
    const tone = mood ? MOODS.find(m => m.key === mood)?.tone : null
    return `
      <div class="${classes.join(' ')}" data-iso="${c.iso}"${tone ? ` style="--tone:${tone}"` : ''} onclick="window.selectCalendarDate('${c.iso}')">
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
  const tick = () => { checkUpcomingReminders(); checkNudge() }
  notifyTimer = setInterval(tick, 30_000)
  setTimeout(tick, 3_000)
}

// ═════════════════════════════════════════════════════════════
//  COMPANION  (Wi-Fi pairing · encrypted backup · opt-in Gemini chat)
//  The laptop hosts a pairing and the phone joins it. When a file changed
//  on both sides, both versions are kept until you pick one here.
// ═════════════════════════════════════════════════════════════
let chatHistory = []          // this session only: never stored, synced or backed up
let chatBusy = false
let aiState = null

// Rust commands reject with plain strings, JS with Errors.
const errText = e => e?.message || String(e)
function setStatus(id, msg) {
  const el = document.getElementById(id)
  if (el) el.textContent = msg
}

async function startPairing() {
  const btn = document.getElementById('pairStartBtn')
  btn.disabled = true
  try {
    const code = await beginHosting()
    document.getElementById('pairCode').value = code
    await showPairQr(code)
    setStatus('syncStatus', 'Scan the QR with your phone. Keep Zyne open on both.')
  } catch (e) { setStatus('syncStatus', errText(e)) }
  finally { btn.disabled = false }
}

async function stopPairing() {
  try { await endHosting() } catch (e) { console.warn('stop pairing:', e) }
  document.getElementById('pairCode').value = ''
  showPairQr('')
  setStatus('syncStatus', 'Pairing stopped.')
}

async function copyPairCode() {
  const input = document.getElementById('pairCode')
  if (!input.value) return
  try { await navigator.clipboard.writeText(input.value); flashToast('Code copied') }
  catch { input.select(); flashToast('Select the code and copy it') }
}

// The code stays in the box: it works again until the laptop's pairing ends.
// Laptop: the pairing code as a QR. Generated on this device, nothing leaves it.
async function showPairQr(code) {
  const box = document.getElementById('pairQr')
  if (!box) return
  if (!code) { box.hidden = true; box.innerHTML = ''; return }
  try {
    const QR = (await import('qrcode')).default
    box.innerHTML = await QR.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#20352a', light: '#ffffff' } })
    box.hidden = false
  } catch (e) { console.warn('qr:', e); box.hidden = true }
}

// Phone: scan the laptop's QR with the camera, then sync straight away.
async function scanPairCode() {
  if (!native) return setStatus('syncStatus', 'Scanning works in the installed app.')
  try {
    const bs = await import('@tauri-apps/plugin-barcode-scanner')
    let perm = await bs.checkPermissions()
    if (perm !== 'granted') perm = await bs.requestPermissions()
    if (perm !== 'granted') return setStatus('syncStatus', 'Camera access is off. Allow it in Android settings, or paste the code instead.')
    const { content } = await bs.scan({ windowed: false, formats: [bs.Format.QRCode] })
    if (!content || !content.includes('#')) return setStatus('syncStatus', 'That QR is not a Zyne pairing code.')
    document.getElementById('joinCode').value = content.trim()
    await joinPairing()
  } catch (e) {
    setStatus('syncStatus', /cancel/i.test(errText(e)) ? '' : errText(e))
  }
}

async function joinPairing() {
  const btn = document.getElementById('joinBtn')
  btn.disabled = true
  setStatus('syncStatus', 'Syncing…')
  try { await connectAndSync(document.getElementById('joinCode').value) }   // success reports via setSyncStatus
  catch (e) { setStatus('syncStatus', errText(e)) }
  finally { btn.disabled = false }
}

// Show each version from where it starts to differ, or every
// version of a journal would preview the same first line.
function renderConflicts() {
  const host = document.getElementById('conflictList')
  if (!host) return
  let conflicts = []
  try { conflicts = Object.values(snapshot().conflicts) } catch {}
  if (!conflicts.length) { host.innerHTML = ''; return }
  const differsAt = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
  host.innerHTML = `<div class="j-section-label">CHANGED ON BOTH · KEEP ONE</div>` + conflicts
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(c => {
      let preview = 'deleted on one device'
      if (c.content !== null) {
        const other = conflicts.find(o => o.path === c.path && o !== c)?.content || ''
        const at = Math.max(0, differsAt(c.content, other) - 30)
        preview = (at ? '…' : '') + c.content.slice(at, at + 140)
      }
      return `
        <div class="j-row">
          <div class="j-text">
            <div class="j-title">${esc(c.path)}</div>
            <div class="j-meta">${esc(preview)}</div>
          </div>
          <button class="btn-mini" onclick="window.keepVersion('${esc(c.path)}','${esc(c.hash)}')">KEEP THIS</button>
        </div>`
    }).join('')
}

async function keepVersion(path, hash) {
  try { await resolveConflict(path, hash); flashToast('Kept') }
  catch (e) { setStatus('syncStatus', errText(e)) }
}

async function exportBackupFile() {
  const pw = document.getElementById('backupPassword')
  try {
    const sealed = await exportBackup(pw.value)
    if (await saveFile(`zyne-backup-${toISODate(new Date())}.zyne`, sealed)) {
      pw.value = ''
      setStatus('backupStatus', 'Backup saved. Keep the password somewhere safe.')
    }
  } catch (e) { setStatus('backupStatus', errText(e)) }
}

async function importBackupFile() {
  const pw = document.getElementById('backupPassword')
  if (pw.value.length < 8) return setStatus('backupStatus', 'Type the backup’s password first.')
  try {
    const file = await chooseFile(['zyne'], 64 * 1024 * 1024)
    if (!file) return
    setStatus('backupStatus', 'Importing…')
    await importBackup(new TextDecoder().decode(file.bytes), pw.value)
    pw.value = ''
    // A merge, not a rollback: edits made here after the backup win.
    setStatus('backupStatus', 'Merged in. Anything changed here since the backup keeps this device’s version; clashes are listed under Sync.')
  } catch (e) { setStatus('backupStatus', errText(e)) }
}

// ─── gemini chat ────────────────────────────────────────────
// Off until you import a key and turn it on. JS reads the key file once and
// hands it to Rust, which keeps it in app data; nothing on this side stores it.
async function renderAiPanel() {
  const host = document.getElementById('aiPanel')
  if (!host) return
  if (!native) { host.innerHTML = `<div class="feed-status">Gemini chat works in the installed app.</div>`; return }
  try { aiState = await invoke('ai_status') }
  catch (e) { host.innerHTML = `<div class="feed-status">${esc(errText(e))}</div>`; return }

  if (!aiState.configured) {
    host.innerHTML = `
      <div class="sheet-label">Off <span class="sheet-sub">— optional. Import a text file holding your own Gemini API key. It stays in this device’s app data and never goes into a sync or a backup.</span></div>
      <div class="companion-actions"><button class="btn-mini" onclick="window.importAiKey()">IMPORT KEY FILE</button></div>`
    renderNextCard()
    return
  }
  const controls = `
    <div class="companion-actions">
      <button class="btn-mini" onclick="window.setAiEnabled(${!aiState.enabled})">${aiState.enabled ? 'TURN OFF' : 'TURN ON'}</button>
      ${aiState.enabled ? `<button class="btn-mini" onclick="window.newChat()">NEW CHAT</button>` : ''}
      <button class="btn-mini" onclick="window.importAiKey()">REPLACE KEY</button>
      <button class="btn-mini" onclick="window.removeAiKey()">REMOVE KEY</button>
    </div>`
  if (!aiState.enabled) {
    host.innerHTML = `<div class="sheet-label">Key imported · AI is off <span class="sheet-sub">— when on, chat messages and “What next?” go to Google (${esc(aiState.model)}). “What next?” sends today’s tasks and events, the last week of journal tasks and focus logs, and your reading list. Nothing else in Zyne does.</span></div>` + controls
    renderNextCard()
    return
  }
  const nudgesOn = (await getSetting('ai_nudges')) === '1'
  const about = (await getSetting('ai_about')) || ''
  const coach = `
    <div class="sheet-label" style="margin-top:14px">What next? <span class="sheet-sub">— on the Focus card. Uses your journal, events and reading list; nothing to fill in.</span></div>
    <input class="input-field" id="aiAbout" maxlength="300" placeholder="Optional: what matters to you lately (e.g. senior project, sleep earlier)" value="${esc(about)}" onchange="window.saveAbout()">
    <div class="companion-actions" style="margin-top:8px">
      <button class="btn-mini" onclick="window.setNudges(${!nudgesOn})">${nudgesOn ? 'NUDGES ON · TURN OFF' : 'TURN ON NUDGES'}</button>
      <span class="sheet-sub">${nudgesOn ? 'A notification with one next step around 9:30, 13:30, 17:00 and 20:30, while Zyne is open. Never during focus.' : 'Off — no AI notifications.'}</span>
    </div>`
  host.innerHTML = `
    <div class="sheet-label">On · ${esc(aiState.model)} <span class="sheet-sub">— chat and “What next?” go to Google. The chat isn’t saved; it’s gone when Zyne closes.</span></div>
    <div class="chat-log" id="chatLog" aria-live="polite"></div>
    <div class="task-input-row" style="border-top:none;padding-top:0">
      <input class="input-field" id="chatInput" placeholder="Ask something…" style="flex:1" autocomplete="off">
      <button class="task-add-btn" onclick="window.sendChat()" aria-label="Send">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </div>` + coach + controls
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat() }
  })
  renderChatLog()
  renderNextCard()
}

function renderChatLog() {
  const log = document.getElementById('chatLog')
  if (!log) return
  log.innerHTML = chatHistory.map(m => `<div class="chat-msg ${m.role}">${esc(m.text)}</div>`).join('') +
    (chatBusy ? `<div class="chat-msg model pending">…</div>` : '')
  log.style.display = log.innerHTML ? '' : 'none'
  log.scrollTop = log.scrollHeight
}

async function sendChat() {
  const input = document.getElementById('chatInput')
  const text = input?.value.trim()
  if (!text || chatBusy) return
  chatHistory.push({ role: 'user', text })
  input.value = ''
  chatBusy = true
  setStatus('aiStatus', '')
  renderChatLog()
  try {
    chatHistory.push({ role: 'model', text: await invoke('ai_chat', { messages: chatWindow(chatHistory) }) })
  } catch (e) {
    // nothing was answered, so give the words back
    chatHistory.pop()
    const box = document.getElementById('chatInput')
    if (box && !box.value) box.value = text
    setStatus('aiStatus', errText(e))
  } finally {
    chatBusy = false
    renderChatLog()
  }
}

function newChat() { chatHistory = []; setStatus('aiStatus', ''); renderChatLog() }

async function configureAi(key, enabled) {
  try { await invoke('ai_configure', { key, enabled }); setStatus('aiStatus', '') }
  catch (e) { setStatus('aiStatus', errText(e)) }
  await renderAiPanel()
}

async function importAiKey() {
  let file
  try { file = await chooseFile(['txt'], 4096) } catch (e) { return setStatus('aiStatus', errText(e)) }
  if (!file) return
  // Replacing a key keeps chat as it was; a first import leaves it off.
  await configureAi(new TextDecoder().decode(file.bytes), !!aiState?.enabled)
}

const setAiEnabled = on => configureAi(null, on)
async function removeAiKey() { chatHistory = []; suggestion = null; await configureAi('', false) }

// ─── what next? + nudges (coach.js) ─────────────────────────
// One suggestion at a time, built from what Zyne already knows: today's
// tasks and events, the last week of journal days, focus logs and the
// reading list. Sent to Google only while AI is on. Nudges are a separate
// switch and fire at most four times a day, never during a focus session.
let suggestion = null
let suggestBusy = false
let suggestErr = ''
let skipped = { day: '', items: [] }

const aiOn = () => native && aiState?.configured && aiState?.enabled

async function gatherContext() {
  const now = new Date()
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i)
    const iso = toISODate(d)
    try { days.push({ iso, entries: await loadDay(iso) }) } catch { days.push({ iso, entries: [] }) }
  }
  let reading = []
  try { reading = await listWant() } catch {}
  const today = toISODate(now)
  if (skipped.day !== today) skipped = { day: today, items: [] }
  return buildContext({
    now, days, reading,
    events: itemsForDate(calendarItems, now),
    about: (await getSetting('ai_about')) || '',
    skipped: skipped.items,
  })
}

async function askWhatNext({ quiet = false } = {}) {
  if (!aiOn() || suggestBusy) return null
  suggestBusy = true; suggestErr = ''
  if (!quiet) renderNextCard()
  try {
    const parsed = parseSuggestion(await invoke('ai_suggest', { context: await gatherContext() }))
    if (!parsed) throw new Error('Gemini answered in an odd way. Try again.')
    suggestion = parsed
  } catch (e) {
    suggestErr = errText(e)
  } finally {
    suggestBusy = false
    renderNextCard()
  }
  return suggestion
}

function renderNextCard() {
  const host = document.getElementById('nextCard')
  if (!host) return
  if (!aiOn() || timerRunning) { host.style.display = 'none'; return }
  host.style.display = ''
  if (!suggestion || suggestBusy) {
    host.className = 'next-card idle'
    host.innerHTML = `
      <div class="next-why">${suggestBusy ? 'Thinking about your day…' : esc(suggestErr || 'Not sure where to start?')}</div>
      <button class="btn-mini" onclick="window.askWhatNext()" ${suggestBusy ? 'disabled' : ''}>WHAT NEXT?</button>`
    return
  }
  const s = suggestion
  host.className = 'next-card'
  host.innerHTML = `
    <div class="next-eyebrow">NEXT</div>
    <div class="next-title">${esc(s.next)}</div>
    ${s.why ? `<div class="next-why">${esc(s.why)}</div>` : ''}
    ${s.firstStep ? `<div class="next-step"><b>Start with:</b> ${esc(s.firstStep)}</div>` : ''}
    <div class="companion-actions">
      <button class="btn-mini" onclick="window.startSuggested()">START · ${s.minutes} MIN</button>
      <button class="btn-mini" onclick="window.notNow()">NOT NOW</button>
    </div>
    ${s.also.length ? `<div class="chip-row">${s.also.map((a, i) =>
      `<button class="chip" onclick="window.startAlso(${i})" title="Start this instead">${esc(a)}</button>`).join('')}</div>` : ''}`
}

function startSuggested() {
  if (!suggestion) return
  startSession(suggestion.next)
}
function startAlso(i) {
  const a = suggestion?.also[i]
  if (a) startSession(a)
}
async function notNow() {
  if (suggestion) skipped.items.push(suggestion.next)
  suggestion = null
  await askWhatNext()
}

async function checkNudge() {
  if (!aiOn() || timerRunning || suggestBusy) return
  if ((await getSetting('ai_nudges')) !== '1') return
  const key = dueNudge(new Date(), await getSetting('ai_nudge_last'))
  if (!key) return
  await setSetting('ai_nudge_last', key)      // mark first: one try per slot, even if it fails
  const s = await askWhatNext({ quiet: true })
  if (s) sendNotification(`Next: ${s.next}`, s.firstStep ? `Start with: ${s.firstStep}` : s.why)
}

async function setNudges(on) {
  await setSetting('ai_nudges', on ? '1' : '0')
  if (on) sendNotification('Zyne nudges are on', 'Around 9:30, 13:30, 17:00 and 20:30, while Zyne is open.')
  renderAiPanel()
}
async function saveAbout() {
  const v = (document.getElementById('aiAbout')?.value || '').trim().slice(0, 300)
  await setSetting('ai_about', v)
  setStatus('aiStatus', v ? 'Saved. Suggestions will keep this in mind.' : 'Cleared.')
}

// ═════════════════════════════════════════════════════════════
//  INPUT BINDINGS
// ═════════════════════════════════════════════════════════════
function bindInputs() {
  const t = document.getElementById('entryInput')
  if (t) t.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitEntry() }
  })
}

// ─── SMALL UTILS ─────────────────────────────────────────────
function val(id)         { return document.getElementById(id)?.value || '' }
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
  // Feed
  refreshFeed, openFeedItem, clipFeedItem, clearFeedBatch,
  setKindFilter, toggleSettings, openSettings, closeSettings, settingsBack, saveSettingsView,
  // Focus
  beginCompose, startSession, stopSession, skipPhase, setMethod,
  toggleFocusSettings,
  playSound, stopSound, openExternal, playNight, toggleNightDone,
  // Mood
  setMood,
  // Daily card
  drawDailyCard, shuffleLine, openDailyCard, keepIfThen,
  // Library
  setLibraryView, saveIdeaCard, wantBook, wantToggle, wantRemove,
  __reloadLibrary: loadLibrary,   // used by the browser-dev self-check
  // Journal
  setEntryType, submitEntry,
  journalToggle, journalMigrate, journalSkip, journalDelete, eventDelete,
  selectCalendarDate, monthStep, jumpToToday,
  // Companion
  startPairing, stopPairing, copyPairCode, joinPairing, scanPairCode, keepVersion,
  exportBackupFile, importBackupFile,
  sendChat, newChat, importAiKey, setAiEnabled, removeAiKey,
  askWhatNext, startSuggested, startAlso, notNow, setNudges, saveAbout,
})
