import { invoke } from '@tauri-apps/api/core'
import { freshState, validateState, MEDIA_TYPES, digest, dayKey } from './companion-model.js'
export const native = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
let state = null
let queue = Promise.resolve()
let database
function browserDb() {
  return database ||= new Promise((resolve,reject) => {
    const req = indexedDB.open('zyne-companion',1)
    req.onupgradeneeded = () => req.result.createObjectStore('data')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(Error('Cannot open local storage'))
  })
}
async function browserRead(key) {
  const db = await browserDb()
  return new Promise((resolve,reject) => { const r=db.transaction('data').objectStore('data').get(key); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error) })
}
async function browserWrite(key,value) {
  const db = await browserDb()
  return new Promise((resolve,reject) => { const t=db.transaction('data','readwrite'); t.objectStore('data').put(value,key); t.oncomplete=resolve; t.onerror=()=>reject(Error('Could not save. Check available storage.')); t.onabort=()=>reject(Error('Save interrupted')) })
}
export async function initStore() {
  const text = native ? await invoke('companion_load') : await browserRead('index')
  state = text ? validateState(JSON.parse(text)) : freshState()
  return snapshot()
}
export function snapshot() { if (!state) throw Error('Storage is not ready'); return structuredClone(state) }
export function transact(fn) {
  const task = queue.then(async () => {
    const next = await fn(snapshot())
    validateState(next)
    const text = JSON.stringify(next)
    if (native) await invoke('companion_save',{contents:text}); else await browserWrite('index',text)
    state = next
    window.dispatchEvent(new Event('zyne-data'))
    return snapshot()
  })
  queue = task.catch(()=>{})
  return task
}
export async function addRecord(type,text,extra={}) {
  const now = new Date().toISOString()
  const record = { id:crypto.randomUUID(), type, text:text.trim(), day:dayKey(), created:now, updated:now, archived:false, ...extra }
  await transact(s=>{s.records[record.id]=record;return s})
  return record
}
export async function setArchived(id, archived) {
  await transact(s=>{if(s.records[id]) {s.records[id].archived=archived;s.records[id].updated=new Date().toISOString()} return s})
}
export async function putMedia(bytes, mime) {
  const ext = MEDIA_TYPES[mime]
  if (!ext || !bytes.length || bytes.length>12*1024*1024) throw Error('Choose a supported photo or audio file under 12 MB')
  const hash = await digest(bytes)
  const media = {hash,mime,ext,size:bytes.length}
  if (native) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir('media',{baseDir:fs.BaseDirectory.AppData,recursive:true})
    await fs.writeFile(`media/${hash}.${ext}`,bytes,{baseDir:fs.BaseDirectory.AppData})
  } else await browserWrite(`media:${hash}`,bytes)
  return media
}
export async function getMedia(media) {
  if (!media || !/^[a-f0-9]{64}$/.test(media.hash) || MEDIA_TYPES[media.mime] !== media.ext) throw Error('Invalid attachment')
  if (native) {
    const fs = await import('@tauri-apps/plugin-fs')
    return fs.readFile(`media/${media.hash}.${media.ext}`,{baseDir:fs.BaseDirectory.AppData})
  }
  const bytes = await browserRead(`media:${media.hash}`)
  if (!bytes) throw Error('Attachment not found. Import a backup containing this memory.')
  return bytes
}
export async function chooseFile(extensions, maxBytes=12*1024*1024) {
  if (native) {
    const {open} = await import('@tauri-apps/plugin-dialog')
    const path = await open({multiple:false,filters:[{name:'Choose a file',extensions}]})
    if (!path) return null
    const fs = await import('@tauri-apps/plugin-fs')
    const metadata = await fs.stat(path)
    if (metadata.size>maxBytes) throw Error('That file is too large')
    return {name:path.split('/').pop(), bytes:await fs.readFile(path)}
  }
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input'); input.type='file'; input.accept=extensions.map(e=>`.${e}`).join(',')
    input.oncancel=()=>resolve(null)
    input.onchange=async()=>{try {const file=input.files[0]; if(!file)return resolve(null);if(file.size>maxBytes)throw Error('That file is too large');resolve({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())})}catch(e){reject(e)}}
    input.click()
  })
}
export async function saveFile(name, contents) {
  if (native) {
    const {save} = await import('@tauri-apps/plugin-dialog')
    const path=await save({defaultPath:name,filters:[{name:'Zyne backup',extensions:['zyne']}]})
    if(!path)return false
    const fs=await import('@tauri-apps/plugin-fs');await fs.writeTextFile(path,contents);return true
  }
  const url=URL.createObjectURL(new Blob([contents],{type:'application/octet-stream'}))
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true
}
