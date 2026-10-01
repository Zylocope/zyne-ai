export const SCHEMA = 1
export const MAX_BYTES = 45 * 1024 * 1024
export const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' }
export const freshState = () => ({ schema: SCHEMA, records: {}, docs: {}, conflicts: {} })
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const HASH = /^[a-f0-9]{64}$/
const ID = /^[a-f0-9-]{36}$/
export const validDocPath = p => /^(journal\/\d{4}-\d{2}-\d{2}\.md|reading-list\.md|(clips|ideas)\/[a-zA-Z0-9_-]+\.md|calendar\/[a-zA-Z0-9-]+\.json)$/.test(p)
export function validateState(s) {
  if (!s || s.schema !== SCHEMA || !s.records || !s.docs || !s.conflicts) throw Error('Unsupported or damaged Zyne data')
  for (const map of [s.records, s.docs, s.conflicts]) if (Array.isArray(map) || typeof map !== 'object' || Object.keys(map).length > 10000) throw Error('Invalid data collection')
  for (const [id,r] of Object.entries(s.records)) {
    if (!ID.test(id) || r.id !== id || !['memory','focus','reflection'].includes(r.type) || typeof r.text !== 'string' || r.text.length > 12000 || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !Number.isFinite(Date.parse(r.created)) || !Number.isFinite(Date.parse(r.updated)) || typeof r.archived !== 'boolean') throw Error('Invalid saved entry')
    if (r.type === 'focus' && (!Number.isFinite(r.minutes) || r.minutes < 0 || r.minutes > 1440)) throw Error('Invalid focus session')
    if (r.media && (!HASH.test(r.media.hash) || !MEDIA_TYPES[r.media.mime] || r.media.ext !== MEDIA_TYPES[r.media.mime] || !Number.isInteger(r.media.size) || r.media.size < 1 || r.media.size > 12*1024*1024)) throw Error('Invalid media attachment')
  }
  const revision = r => {
    if (!r || !HASH.test(r.hash) || (r.content !== null && (typeof r.content !== 'string' || r.content.length > 2*1024*1024)) || !Array.isArray(r.ancestors) || r.ancestors.length > 2000 || r.ancestors.some(h => !HASH.test(h))) throw Error('Invalid document revision')
  }
  for (const [path,r] of Object.entries(s.docs)) { if (!validDocPath(path)) throw Error('Invalid document path'); revision(r) }
  for (const [key,r] of Object.entries(s.conflicts)) { if (!validDocPath(r.path) || key !== `${r.path}:${r.hash}`) throw Error('Invalid conflict'); revision(r) }
  return s
}
// Immutable entry IDs and revision ancestry make repeat transfers idempotent.
// Concurrent document edits are retained for an explicit, reversible choice.
export function mergeStates(left, right) {
  validateState(left); validateState(right)
  const out = structuredClone(left)
  for (const [id,r] of Object.entries(right.records)) {
    const old = out.records[id]
    if (!old || `${r.updated}:${JSON.stringify(r)}` > `${old.updated}:${JSON.stringify(old)}`) out.records[id] = structuredClone(r)
  }
  Object.assign(out.conflicts, structuredClone(right.conflicts))
  for (const [path,r] of Object.entries(right.docs)) {
    const old = out.docs[path]
    if (!old) { out.docs[path] = structuredClone(r); continue }
    if (old.hash === r.hash) { old.ancestors = [...new Set([...old.ancestors, ...r.ancestors])]; continue }
    if (r.ancestors.includes(old.hash)) { out.docs[path] = structuredClone(r); continue }
    if (old.ancestors.includes(r.hash)) continue
    out.conflicts[`${path}:${old.hash}`] = { ...old, path }
    out.conflicts[`${path}:${r.hash}`] = { ...r, path }
    out.docs[path] = structuredClone(old.hash > r.hash ? old : r)
  }
  for (const [key,c] of Object.entries(out.conflicts)) if (out.docs[c.path]?.ancestors.includes(c.hash)) delete out.conflicts[key]
  return out
}
export function growth(records) {
  const days = new Map()
  for (const r of Object.values(records)) {
    const daily = days.get(r.day) || { focus: 0, memory: 0, reflection: 0 }
    if (r.type === 'focus') daily.focus = Math.min(10, daily.focus + Math.floor(r.minutes / 5)*2)
    else daily[r.type] = 5
    days.set(r.day, daily)
  }
  const points = [...days.values()].reduce((n,d) => n + d.focus + d.memory + d.reflection, 0)
  return { points, plant: points >= 5, books: points >= 15, stars: points >= 30, scarf: points >= 50 }
}
export async function digest(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('')
}
export const contentHash = content => digest(JSON.stringify(content))
export function base64(bytes) {
  let text = ''
  for (let i=0;i<bytes.length;i+=8192) text += String.fromCharCode(...bytes.subarray(i,i+8192))
  return btoa(text)
}
export const unbase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))
export async function seal(value, secret, salt = null) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await encryptionKey(secret, salt)
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  if (bytes.length > MAX_BYTES) throw Error('This transfer exceeds 45 MB. Archive media externally before adding more.')
  const data = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, bytes)
  return JSON.stringify({ format:'zyne-encrypted-v1', salt: salt ? base64(salt) : null, iv:base64(iv), data:base64(new Uint8Array(data)) })
}
export async function unseal(text, secret, backup = false) {
  if (text.length > 64*1024*1024) throw Error('Transfer too large')
  const e = JSON.parse(text)
  if (e.format !== 'zyne-encrypted-v1' || typeof e.data !== 'string' || typeof e.iv !== 'string' || (backup ? typeof e.salt !== 'string' : e.salt !== null)) throw Error('Not a valid Zyne transfer')
  const iv = unbase64(e.iv), salt = e.salt ? unbase64(e.salt) : null
  if (iv.length !== 12 || (salt && salt.length !== 16)) throw Error('Invalid encryption data')
  try {
    const key = await encryptionKey(secret, salt)
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,unbase64(e.data))))
  } catch { throw Error('Wrong pairing code / backup password, or damaged transfer. Nothing was imported.') }
}
async function encryptionKey(secret, salt) {
  const raw = new TextEncoder().encode(secret)
  if (salt) {
    if (secret.length < 8) throw Error('Use a backup password of at least 8 characters')
    const material = await crypto.subtle.importKey('raw',raw,'PBKDF2',false,['deriveKey'])
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
  }
  if (!HASH.test(secret)) throw Error('Invalid pairing code')
  const hashed = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`zyne-data:${secret}`))
  return crypto.subtle.importKey('raw',hashed,'AES-GCM',false,['encrypt','decrypt'])
}
