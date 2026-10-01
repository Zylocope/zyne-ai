import { invoke } from '@tauri-apps/api/core'
import { getDb } from './db.js'
import { native, snapshot, transact, getMedia, putMedia } from './companion-store.js'
import { freshState, validateState, mergeStates, contentHash, digest, base64, unbase64, seal, unseal, validDocPath, MAX_BYTES } from './companion-model.js'

const root = 'ZyneVault/'
const calendarFields = ['id','name','time_start','duration_minutes','category','date','recurrence_rule','notify_minutes','notes','created_at']
let busy = false, hosting = null, interval = null
let notify = () => {}
export function setSyncStatus(callback) { notify = callback }
function calendarRow(text, id) {
  const row=JSON.parse(text)
  if(row.id!==id || typeof row.name!=='string' || row.name.length>10000)throw Error('Invalid calendar entry')
  for(const field of calendarFields)if(row[field]!==null && row[field]!==undefined && !['string','number'].includes(typeof row[field]))throw Error('Invalid calendar field')
  for(const field of ['duration_minutes','notify_minutes'])if(row[field]!=null && (!Number.isFinite(row[field]) || row[field]<0 || row[field]>525600))throw Error('Invalid calendar duration')
  return row
}
async function readDocuments() {
  const docs={}
  if(native){
    const fs=await import('@tauri-apps/plugin-fs'), options={baseDir:fs.BaseDirectory.Document}
    for(const sub of ['journal','clips','ideas']) {
      const dir=root+sub
      if(!await fs.exists(dir,options))continue
      for(const entry of await fs.readDir(dir,options)) {
        const path=`${sub}/${entry.name}`
        if(entry.isFile && validDocPath(path)) docs[path]=await fs.readTextFile(root+path,options)
      }
    }
    if(await fs.exists(root+'reading-list.md',options))docs['reading-list.md']=await fs.readTextFile(root+'reading-list.md',options)
    const db=await getDb()
    for(const row of await db.select('SELECT * FROM schedule_items')) {
      const clean=Object.fromEntries(calendarFields.map(k=>[k,row[k]??null]))
      docs[`calendar/${row.id}.json`]=JSON.stringify(clean)
    }
  } else {
    for(let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i)
      if(/^zyne_journal_\d{4}-\d{2}-\d{2}$/.test(key))docs[`journal/${key.slice(13)}.md`]=localStorage.getItem(key)
      if(key.startsWith('zyne_vault_') && validDocPath(key.slice(11)))docs[key.slice(11)]=localStorage.getItem(key)
    }
  }
  return docs
}
async function trackDocuments(state) {
  const current=await readDocuments()
  for(const path of new Set([...Object.keys(current),...Object.keys(state.docs)])) {
    const content=current[path]??null, hash=await contentHash(content), old=state.docs[path]
    if(old?.hash===hash)continue
    state.docs[path]={content,hash,ancestors:old?[...new Set([...old.ancestors,old.hash])]:[]}
  }
  return state
}
async function writeDocuments(before, after) {
  const actual=await readDocuments()
  for(const [path,r] of Object.entries(after.docs)) {
    if(before.docs[path]?.hash===r.hash)continue
    const expected=before.docs[path]?.content??null
    if((actual[path]??null)!==expected)throw Error('A journal changed while syncing. Try Sync again; both copies are kept.')
    if(native){
      const fs=await import('@tauri-apps/plugin-fs')
      // Preserve the previous on-device version before applying remote edits.
      if(actual[path]!=null){
        await fs.mkdir('sync-backups',{baseDir:fs.BaseDirectory.AppData,recursive:true})
        await fs.writeTextFile(`sync-backups/${await digest(path+actual[path])}.txt`,actual[path],{baseDir:fs.BaseDirectory.AppData})
      }
      if(path.startsWith('calendar/')){
        const id=path.slice(9,-5),db=await getDb()
        if(r.content===null)await db.execute('DELETE FROM schedule_items WHERE id=$1',[id])
        else {
          const row=calendarRow(r.content,id)
          await db.execute(`INSERT INTO schedule_items (${calendarFields.join(',')}) VALUES (${calendarFields.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT(id) DO UPDATE SET ${calendarFields.slice(1).map(k=>`${k}=excluded.${k}`).join(',')}`,calendarFields.map(k=>row[k]??null))
        }
      }else{
        const options={baseDir:fs.BaseDirectory.Document}
        if(r.content===null){if(await fs.exists(root+path,options))await fs.remove(root+path,options)}
        else {await fs.mkdir(root+(path.includes('/')?path.split('/')[0]:''),{...options,recursive:true});await fs.writeTextFile(root+path,r.content,options)}
      }
    }else{
      const key=path.startsWith('journal/')?'zyne_journal_'+path.slice(8,-3):'zyne_vault_'+path
      if(r.content===null)localStorage.removeItem(key);else localStorage.setItem(key,r.content)
    }
  }
}
export async function makePackage() {
  await transact(trackDocuments)
  const state=snapshot(),media={};let total=JSON.stringify(state).length
  for(const r of Object.values(state.records))if(r.media && !media[r.media.hash]){
    const bytes=await getMedia(r.media);total+=Math.ceil(bytes.length*4/3)
    if(total>MAX_BYTES)throw Error('Your transfer exceeds 45 MB. Keep an external backup of large recordings.')
    media[r.media.hash]={meta:r.media,data:base64(bytes)}
  }
  return {schema:1,state,media}
}
export async function importPackage(pack) {
  if(!pack || pack.schema!==1 || !pack.media || typeof pack.media!=='object')throw Error('Unsupported backup')
  validateState(pack.state)
  // Validate every attachment and revision before touching any local data.
  const checked=[];let total=JSON.stringify(pack.state).length
  for(const r of Object.values(pack.state.records))if(r.media && !checked.some(m=>m.meta.hash===r.media.hash)){
    const item=pack.media[r.media.hash]
    if(!item || typeof item.data!=='string' || item.data.length>17*1024*1024)throw Error('Backup is missing an attachment')
    total+=item.data.length;if(total>MAX_BYTES)throw Error('Transfer is too large')
    const bytes=unbase64(item.data)
    if(bytes.length!==r.media.size || await digest(bytes)!==r.media.hash)throw Error('Attachment checksum failed; nothing imported')
    checked.push({meta:r.media,bytes})
  }
  for(const [path,r] of [...Object.entries(pack.state.docs),...Object.values(pack.state.conflicts).map(c=>[c.path,c])]){
    if(await contentHash(r.content)!==r.hash)throw Error('Document checksum failed')
    if(path.startsWith('calendar/') && r.content!==null)calendarRow(r.content,path.slice(9,-5))
  }
  for(const item of checked)await putMedia(item.bytes,item.meta.mime)
  await transact(async s=>{
    const before=await trackDocuments(s), after=mergeStates(before,pack.state)
    await writeDocuments(before,after)
    return after
  })
  window.dispatchEvent(new Event('zyne-sync-complete'))
}
export async function resolveConflict(path, hash) {
  await transact(async s=>{
    const before=await trackDocuments(s), after=structuredClone(before)
    const choice=after.conflicts[`${path}:${hash}`]
    if(!choice)throw Error('That version is no longer available')
    const versions=Object.values(after.conflicts).filter(c=>c.path===path)
    after.docs[path]={content:choice.content,hash:choice.hash,ancestors:[...new Set([...versions.flatMap(v=>[v.hash,...v.ancestors]),before.docs[path].hash,...before.docs[path].ancestors])].filter(h=>h!==choice.hash)}
    for(const [key,c]of Object.entries(after.conflicts))if(c.path===path)delete after.conflicts[key]
    await writeDocuments(before,after);return after
  })
  window.dispatchEvent(new Event('zyne-sync-complete'))
}
export async function beginHosting() {
  if(!native)throw Error('Wi-Fi pairing works in the installed app')
  if(busy)throw Error('A transfer is already running')
  busy=true
  try{
    await endHosting()
    const secret=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
    const auth=await digest(`zyne-auth:${secret}`), pack=await makePackage()
    const {address}=await invoke('lan_start',{auth,payload:await seal(pack,secret)})
    hosting={secret,address,started:Date.now()}
    interval=setInterval(hostTick,3000)
    return `${address}#${secret}`
  }finally{busy=false}
}
async function hostTick() {
  if(busy||!hosting)return
  if(Date.now()-hosting.started>29*60*1000){await endHosting();notify('Pairing expired. Start a new connection.');return}
  busy=true
  try{
    const incoming=await invoke('lan_poll')
    for(const message of incoming){await importPackage(await unseal(message,hosting.secret));notify('Phone data received. Both copies are saved locally.')}
    // Refresh the snapshot so subsequent phone syncs see recent laptop edits.
    await invoke('lan_publish',{payload:await seal(await makePackage(),hosting.secret)})
  }catch(e){notify(`Sync paused: ${e.message||e}`)}finally{busy=false}
}
export async function endHosting() {
  clearInterval(interval);interval=null;hosting=null
  if(native)await invoke('lan_stop')
}
export async function connectAndSync(code) {
  if(!native)throw Error('Wi-Fi pairing works in the installed app')
  if(busy)throw Error('A transfer is already running')
  const match=code.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}:\d{1,5})#([a-f0-9]{64})$/)
  if(!match)throw Error('Paste the full pairing code from your laptop')
  busy=true
  try{
    const [,address,secret]=match, auth=await digest(`zyne-auth:${secret}`)
    const text=await invoke('lan_request',{address,auth,payload:null})
    await importPackage(await unseal(text,secret))
    await invoke('lan_request',{address,auth,payload:await seal(await makePackage(),secret)})
    notify('Laptop data saved here; your changes were sent. Keep both apps open until the laptop confirms receipt.')
  }finally{busy=false}
}
export async function exportBackup(password) { return seal(await makePackage(),password,crypto.getRandomValues(new Uint8Array(16))) }
export async function importBackup(text,password) { await importPackage(await unseal(text,password,true)) }
