// ─────────────────────────────────────────────────────────────
//  FEED — source list + fetchers (YouTube RSS, Reddit JSON,
//  HN Algolia, GitHub API, Google News RSS, generic RSS/Atom).
//  All client-side. In Tauri, fetch goes through plugin-http
//  (no CORS). In plain-browser dev, known hosts route through
//  the vite proxy (see vite.config.ts).
// ─────────────────────────────────────────────────────────────

// One source per line: "<type> <value> | <Display Name>" (name optional).
// Types: youtube <channelId> · reddit <sub> · hn front · github <owner/repo>
//        gnews <world|business|technology|science|nation> · rss <url>
// Every feed below was verified reachable on 2026-07-27.
import { extractIdeas, looksLikeBook } from './books.js'

export const SOURCES_SEED_VERSION = '3'
export const DEFAULT_SOURCES = `# ── AI & LLM
youtube UC4ZVkG3RQPzvZk7alIVjcCg | Sandeep Swadia
youtube UCP235oUhop0rvk7wuJTjx6A | TBH Labs
youtube UCbfYPyITQ-7l4upoX8nvctg | Two Minute Papers
reddit LocalLLaMA
reddit MachineLearning
rss https://simonwillison.net/atom/everything/ | Simon Willison
rss https://www.interconnects.ai/feed | Interconnects
rss https://importai.substack.com/feed | Import AI
rss https://www.latent.space/feed | Latent Space
rss https://huggingface.co/blog/feed.xml | Hugging Face
rss https://www.oneusefulthing.org/feed | One Useful Thing
# ── Business & strategy
gnews business | Business
rss https://stratechery.com/feed/ | Stratechery
rss http://feeds.hbr.org/harvardbusiness | Harvard Business Review
rss https://www.economist.com/finance-and-economics/rss.xml | Economist Finance
rss https://nav.al/feed | Naval
youtube UCcefcZRL2oaA_uBNeo5UOWg | Y Combinator
youtube UCPjNBjflYl0-HQtUvOx0Ibw | Greg Isenberg
reddit startups
reddit SaaS
# ── Product
rss https://www.lennysnewsletter.com/feed | Lenny's Newsletter
rss https://www.svpg.com/feed/ | SVPG
rss https://www.producthunt.com/feed | Product Hunt
youtube UC6t1O76G0jYXOAoYCm153dA | Lenny's Podcast
# ── Code
hn front | Hacker News
github nextlevelbuilder/ui-ux-pro-max-skill
youtube UCsBjURrPoezykLs9EqgamOA | Fireship
rss https://newsletter.pragmaticengineer.com/feed | Pragmatic Engineer
rss https://changelog.com/feed | Changelog
rss https://web.dev/feed.xml | web.dev
rss https://css-tricks.com/feed/ | CSS-Tricks
reddit ExperiencedDevs
# ── Design
rss https://www.smashingmagazine.com/feed/ | Smashing Magazine
rss https://www.nngroup.com/feed/rss/ | NN/g
rss https://uxdesign.cc/feed | UX Collective
rss https://alistapart.com/main/feed/ | A List Apart
# ── Crypto (education, not trading calls)
youtube UCh1ob28ceGdqohUnR7vBACA | Finematics
youtube UCsYYksPHiGqXHPoHI-fm5sg | Whiteboard Crypto
youtube UCqK_GSMbpiV8spgD3ZGloSw | Coin Bureau
rss https://blog.ethereum.org/feed.xml | Ethereum Blog
rss https://vitalik.eth.limo/feed.xml | Vitalik Buterin
rss https://decrypt.co/feed | Decrypt
rss https://cointelegraph.com/rss | Cointelegraph
# ── China & world tech
rss https://technode.com/feed/ | TechNode
rss https://pandaily.com/feed/ | Pandaily
rss https://www.scmp.com/rss/36/feed | SCMP Tech
rss https://restofworld.org/feed/latest/ | Rest of World
# ── World news
gnews world | World
gnews technology | Tech
rss https://feeds.bbci.co.uk/news/world/rss.xml | BBC World
rss https://www.aljazeera.com/xml/rss/all.xml | Al Jazeera
# ── Consumer tech & creators
youtube UCBJycsmduvYEL83R_U4JriQ | MKBHD
youtube UCamLstJyCa-t5gfZegxsFMw | Colin and Samir
youtube UCoOae5nYA7VqaXzerajD0lg | Ali Abdaal
# ── Books & learning (these become idea cards, not article cards)
books https://fourminutebooks.com/feed/ | Four Minute Books
books https://blas.com/feed/ | Blas Moros
rss https://sive.rs/en.atom | Derek Sivers
rss https://fs.blog/feed/ | Farnam Street
rss https://nesslabs.com/feed | Ness Labs
rss https://jamesclear.com/feed | James Clear
rss https://calnewport.com/feed/ | Cal Newport
rss https://ryanholiday.net/feed/ | Ryan Holiday
reddit suggestmeabook`

// Book-summary sources: these publish the full article in RSS with a
// consistent structure, which is what makes idea extraction possible.
export const BOOK_SOURCES = `books https://fourminutebooks.com/feed/ | Four Minute Books
books https://blas.com/feed/ | Blas Moros`

export function parseSources(text) {
  return (text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [spec, name] = l.split('|').map(s => s.trim())
      const [type, ...rest] = spec.split(/\s+/)
      return { type: type.toLowerCase(), value: rest.join(' '), name: name || '' }
    })
    .filter(s => s.type && s.value)
}

// ─── HTTP (Tauri plugin-http, or vite proxy in browser dev) ──
const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
let tauriFetchP = null

async function httpGet(url) {
  let f = fetch
  let target = url
  if (IS_TAURI) {
    if (!tauriFetchP) tauriFetchP = import('@tauri-apps/plugin-http').then(m => m.fetch)
    f = await tauriFetchP
  } else {
    // browser dev: route any host through the vite /zx proxy (see vite.config.ts)
    const u = new URL(url)
    target = `/zx/${u.hostname}${u.pathname}${u.search}`
  }
  // Reddit & co. 403 default library UAs; browsers ignore this header (proxy sets it in dev)
  const opts = IS_TAURI ? { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) zyne-feed/0.1' } } : undefined
  const res = await f(target, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

// ─── Parse helpers ───────────────────────────────────────────
function hashId(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16)
}

function toISO(dateStr) {
  const t = Date.parse(dateStr)
  return t ? new Date(t).toISOString() : new Date().toISOString()
}

function stripHTML(s) {
  // DOMParser html doc is inert — safe for untrusted markup
  const doc = new DOMParser().parseFromString(s || '', 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error('bad XML')
  return doc
}

const nsTag = (el, local) => el.getElementsByTagNameNS('*', local)[0]
const txt = (el, local) => nsTag(el, local)?.textContent?.trim() || ''

function item(o) {
  return {
    id: hashId(o.url || o.title),
    source: o.source || '',
    kind: o.kind || 'article',
    title: o.title || '(untitled)',
    summary: (o.summary || '').slice(0, 300),
    url: o.url || '',
    thumb: o.thumb || '',
    published_at: o.published_at || new Date().toISOString(),
  }
}

// ─── Fetchers ────────────────────────────────────────────────
async function fetchYouTube(channelId, name) {
  const doc = xml(await httpGet(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`))
  const feedName = name || txt(doc.documentElement, 'title')
  return [...doc.getElementsByTagNameNS('*', 'entry')].slice(0, 5).map(e => item({
    source: feedName,
    kind: 'video',
    title: txt(e, 'title'),
    summary: stripHTML(txt(e, 'description')).slice(0, 160),
    url: nsTag(e, 'link')?.getAttribute('href') || '',
    thumb: nsTag(e, 'thumbnail')?.getAttribute('url') || '',
    published_at: toISO(txt(e, 'published')),
  }))
}

async function fetchReddit(sub, name) {
  // .rss instead of .json — reddit 403s non-browser clients on the json endpoint
  const doc = xml(await httpGet(`https://www.reddit.com/r/${sub}/top/.rss?t=day`))
  return [...doc.getElementsByTagNameNS('*', 'entry')].slice(0, 8).map(e => item({
    source: name || `r/${sub}`,
    kind: 'post',
    title: txt(e, 'title'),
    summary: `r/${sub} · top today`,
    url: nsTag(e, 'link')?.getAttribute('href') || '',
    thumb: nsTag(e, 'thumbnail')?.getAttribute('url') || '',
    published_at: toISO(txt(e, 'updated') || txt(e, 'published')),
  }))
}

async function fetchHN(_value, name) {
  const json = JSON.parse(await httpGet('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15'))
  return (json.hits || []).map(h => item({
    source: name || 'Hacker News',
    kind: 'article',
    title: h.title,
    summary: `${h.points} points · ${h.num_comments} comments`,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    published_at: toISO(h.created_at),
  }))
}

async function fetchGitHub(repo, name) {
  const d = JSON.parse(await httpGet(`https://api.github.com/repos/${repo}`))
  return [{
    ...item({
      source: name || 'GitHub',
      kind: 'repo',
      title: d.full_name || repo,
      summary: d.description || '',
      url: d.html_url || `https://github.com/${repo}`,
      published_at: toISO(d.pushed_at),
    }),
    // id changes with star count → card resurfaces when stars move
    id: hashId(`${repo}@${d.stargazers_count}`),
    stars: d.stargazers_count,
  }]
}

const GNEWS_TOPICS = { world: 'WORLD', nation: 'NATION', business: 'BUSINESS', technology: 'TECHNOLOGY', science: 'SCIENCE', health: 'HEALTH' }

async function fetchGNews(topic, name) {
  const t = GNEWS_TOPICS[topic.toLowerCase()] || 'WORLD'
  const doc = xml(await httpGet(`https://news.google.com/rss/headlines/section/topic/${t}?hl=en-US&gl=US&ceid=US:en`))
  return [...doc.getElementsByTagName('item')].slice(0, 8).map(e => item({
    source: name || `Google News · ${topic}`,
    kind: 'article',
    title: txt(e, 'title'),
    summary: '',
    url: txt(e, 'link'),
    published_at: toISO(txt(e, 'pubDate')),
  }))
}

async function fetchRSS(url, name) {
  const doc = xml(await httpGet(url))
  const feedName = name || txt(doc.documentElement, 'title') || new URL(url).hostname
  const entries = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagNameNS('*', 'entry')]
  return entries.slice(0, 6).map(e => {
    const linkEl = nsTag(e, 'link')
    const link = txt(e, 'link') || linkEl?.getAttribute('href') || ''
    const media = [...e.getElementsByTagNameNS('*', 'content'), ...e.getElementsByTagNameNS('*', 'thumbnail')]
      .find(m => m.getAttribute('url'))
    const enclosure = nsTag(e, 'enclosure')
    return item({
      source: feedName,
      kind: 'article',
      title: txt(e, 'title'),
      summary: stripHTML(txt(e, 'description') || txt(e, 'summary')).slice(0, 200),
      url: link,
      thumb: media?.getAttribute('url') || (enclosure?.getAttribute('type')?.startsWith('image') ? enclosure.getAttribute('url') : ''),
      published_at: toISO(txt(e, 'pubDate') || txt(e, 'published') || txt(e, 'updated')),
    })
  })
}

// Book-summary feeds → one card per idea, not one card per article.
async function fetchBooks(url, name) {
  const doc = xml(await httpGet(url))
  const feedName = name || new URL(url).hostname
  const entries = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagNameNS('*', 'entry')]
  const out = []
  for (const e of entries.slice(0, 10)) {
    // mixed feeds also carry podcasts and essays — those aren't books
    if (!looksLikeBook(txt(e, 'title'))) continue
    const linkEl = nsTag(e, 'link')
    const link = txt(e, 'link') || linkEl?.getAttribute('href') || ''
    // full article lives in content:encoded; fall back to the summary
    const body = e.getElementsByTagNameNS('*', 'encoded')[0]?.textContent
      || txt(e, 'description') || txt(e, 'summary') || txt(e, 'content')
    const media = [...e.getElementsByTagNameNS('*', 'content'), ...e.getElementsByTagNameNS('*', 'thumbnail')]
      .find(m => m.getAttribute('url'))
    const thumb = media?.getAttribute('url')
      || (/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/i.exec(body || '') || [''])[0]
    const ideas = extractIdeas(body, {
      rawTitle: txt(e, 'title'),
      url: link,
      source: feedName,
      thumb,
      published_at: toISO(txt(e, 'pubDate') || txt(e, 'published') || txt(e, 'updated')),
    })
    for (const idea of ideas) out.push({ ...idea, id: hashId(`${link}|${idea.text.slice(0, 48)}`) })
  }
  return out
}

const FETCHERS = { youtube: fetchYouTube, reddit: fetchReddit, hn: fetchHN, github: fetchGitHub, gnews: fetchGNews, rss: fetchRSS, books: fetchBooks }

// Fetch every source in parallel; failed sources are skipped, not fatal.
// Returns { items, errors }.
export async function fetchAllSources(sources) {
  const results = await Promise.allSettled(
    sources.map(s => (FETCHERS[s.type] || (() => Promise.reject(new Error(`unknown type ${s.type}`))))(s.value, s.name))
  )
  const items = []
  const errors = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value)
    else errors.push(`${sources[i].type} ${sources[i].value}: ${r.reason?.message || r.reason}`)
  })
  // De-dupe by title prefix across sources (same story from two feeds)
  const seen = new Set()
  const unique = items.filter(it => {
    const k = it.title.toLowerCase().slice(0, 60)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  unique.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  return { items: unique, errors }
}

// Round-robin across sources so one chatty feed can't drown the batch.
// Input assumed newest-first; order within each source is preserved.
export function interleaveBySource(items, cap = 60) {
  const groups = new Map()
  for (const it of items) {
    if (!groups.has(it.source)) groups.set(it.source, [])
    groups.get(it.source).push(it)
  }
  const out = []
  let added = true
  while (out.length < cap && added) {
    added = false
    for (const g of groups.values()) {
      if (!g.length) continue
      out.push(g.shift())
      added = true
      if (out.length >= cap) break
    }
  }
  return out
}
