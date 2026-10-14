<script lang="ts">
import {onMount} from 'svelte';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import Icon from './Icon.svelte';
import {Vault,isNote,type Note} from './lib/vault';
import {isImage,mime,fromBase64,toBase64,validPath} from './lib/crypto';

const vault=new Vault();
let revision=$state(0),unlocked=$state(false),password=$state(''),busy=$state(false),loginError=$state(''),uiError=$state('');
let selectedId=$state(''),search=$state(''),folder=$state(''),tag=$state(''),mobileEditor=$state(false);
let dialog=$state(''),name=$state(''),dark=$state(localStorage.getItem('theme')==='dark'),menu=$state(false);
let frame:HTMLIFrameElement|undefined=$state(),imageInput:HTMLInputElement|undefined=$state(),importInput:HTMLInputElement|undefined=$state();
let frameReady=false,editorId='',editorContent='',generation=0,editorBusy=false,lastActivity=Date.now();
let imageStamp='',imageURLs:Record<string,string>={};
let releaseTab:(()=>void)|undefined;
const flushes=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const notes=$derived.by(()=>{revision;return vault.notes.filter(n=>!n.deleted&&isNote(n.path)).sort((a,b)=>b.modified-a.modified||a.path.localeCompare(b.path));});
const selected=$derived.by(()=>{revision;return vault.notes.find(n=>n.id===selectedId&&!n.deleted);});
const folders=$derived([...new Set(notes.map(n=>n.path.includes('/')?n.path.slice(0,n.path.lastIndexOf('/')):'').filter(Boolean))].sort());
const tags=$derived([...new Set(notes.flatMap(n=>[...n.content.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(m=>m[1])))].sort());
const visible=$derived(notes.filter(n=>(!folder||n.path.startsWith(folder+'/'))&&(!tag||new RegExp(`(?:^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=\\s|$|[.,!?])`,'u').test(n.content))&&(!search||(n.path+'\n'+n.content).toLowerCase().includes(search.toLowerCase()))));
const status=$derived.by(()=>{revision;return vault.status;});
const error=$derived.by(()=>{revision;return vault.error;});
const notice=$derived.by(()=>{revision;return vault.notice;});
function api():any {return (frame?.contentWindow as any)?.FutoEditor;}
function fail(error:unknown){uiError=error instanceof Error?error.message:String(error);}
async function action(fn:()=>Promise<unknown>){uiError='';try{await fn();}catch(error){fail(error);}}
function focusModal(node:HTMLElement){
  const previous=document.activeElement as HTMLElement;
  node.querySelector<HTMLInputElement>('input')?.focus();
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'){dialog='';return;}if(event.key==='Tab'){const items=[...node.querySelectorAll<HTMLElement>('button,input,a,select')].filter(el=>!el.hasAttribute('disabled'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  node.addEventListener('keydown',keys);return {destroy(){node.removeEventListener('keydown',keys);previous?.focus();}};
}
function title(note:Note){return note.path.split('/').pop()!.replace(/\.md$/i,'');}
function excerpt(note:Note){return note.content.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[#*`>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,105)||'Empty note';}
function date(ms:number){return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(ms);}
function theme(){document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('theme',dark?'dark':'light');api()?.setTheme(dark?'dark':'light');}
function refreshEditor(){
  if(!unlocked||!frameReady||!api()||!selected)return;
  const images=vault.notes.filter(n=>!n.deleted&&isImage(n.path));
  const stamp=images.map(n=>`${n.id}:${n.modified}`).join('|');
  if(stamp!==imageStamp){Object.values(imageURLs).forEach(url=>URL.revokeObjectURL(url));imageURLs=vault.imageURLs();imageStamp=stamp;(frame!.contentWindow as any).__futoWebImages=imageURLs;api().setImageBaseUrl(`/web/missing-image/${Date.now()}/`);}
  const universe=notes.map(n=>({id:n.path.replace(/\.md$/i,''),title:title(n),modifiedMs:n.modified}));
  api().setNotes(JSON.stringify(universe));
  if(editorId!==selected.id){editorId=selected.id;editorContent=selected.content;editorBusy=false;api().setContent(editorId,editorContent);}
  else if(!editorBusy&&selected.content!==editorContent){editorContent=selected.content;api().applyExternalContent(editorId,editorContent,generation);}
}
vault.onchange=()=>{revision++;queueMicrotask(refreshEditor);};
async function flush(){
  if(!unlocked||!frameReady||!editorId||!api())return;
  const token=crypto.randomUUID();
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{flushes.delete(token);reject(new Error('The editor did not finish saving. Keep this tab open and try again.'));},8000);
    flushes.set(token,{resolve,reject,timer});api().flush(token);
  });
}
vault.beforeSync=flush;vault.beforeRemote=flush;
async function acquireTab(){
  if(!navigator.locks)throw new Error('This browser does not support safe offline storage locking. Use a current Chrome, Firefox or Safari.');
  await new Promise<void>((resolve,reject)=>{
    navigator.locks.request('futo-notes-vault',{ifAvailable:true},async lock=>{
      if(!lock){reject(new Error('Your notes are already open in another tab. Lock that tab first.'));return;}
      await new Promise<void>(release=>{releaseTab=release;resolve();});
    }).catch(reject);
  });
}
async function unlock(event:SubmitEvent){
  event.preventDefault();busy=true;loginError='';
  try{if(!crypto.subtle)throw new Error('Open this app over HTTPS to unlock your notes.');await acquireTab();await vault.unlock(password);password='';unlocked=true;selectedId=notes[0]?.id||'';lastActivity=Date.now();}
  catch(error){loginError=error instanceof Error?error.message:String(error);releaseTab?.();releaseTab=undefined;}
  finally{busy=false;}
}
async function lock(){await flush();await vault.lock();unlocked=false;frameReady=false;editorId='';editorContent='';editorBusy=false;selectedId='';dialog='';menu=false;Object.values(imageURLs).forEach(URL.revokeObjectURL);imageURLs={};imageStamp='';releaseTab?.();releaseTab=undefined;}
async function select(note:Note){await flush();selectedId=note.id;mobileEditor=true;queueMicrotask(refreshEditor);}
async function newNote(){await flush();name=folder?folder+'/Untitled':'Untitled';dialog='new';menu=false;}
async function saveName(event:SubmitEvent){
  event.preventDefault();await action(async()=>{
    await flush();const path=validPath(name.trim().replace(/\.md$/i,'')+'.md');
    if(dialog==='new'){const note=await vault.create(path);selectedId=note.id;mobileEditor=true;}
    else await vault.rename(selectedId,path);
    dialog='';queueMicrotask(refreshEditor);
  });
}
async function deleteNote(){await flush();await vault.remove(selectedId);selectedId=notes[0]?.id||'';dialog='';menu=false;queueMicrotask(refreshEditor);}
function download(filename:string,blob:Blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportAll(){await flush();const files:Record<string,Uint8Array>={};for(const n of vault.notes.filter(n=>!n.deleted))files[n.path]=isImage(n.path)?fromBase64(n.content):strToU8(n.content);download(`notes-${new Date().toISOString().slice(0,10)}.zip`,new Blob([zipSync(files)],{type:'application/zip'}));menu=false;}
async function importFiles(files:FileList|null){
  if(!files)return;await flush();
  for(const file of files){
    if(file.size>50*1024*1024)throw new Error('Imports are limited to 50 MB per file.');
    const entries=/\.zip$/i.test(file.name)?unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>entry.originalSize<=20*1024*1024}):{[file.name]:new Uint8Array(await file.arrayBuffer())};
    let total=0;
    for(const [original,bytes] of Object.entries(entries)){
      total+=bytes.length;if(total>100*1024*1024)throw new Error('Unpacked imports are limited to 100 MB.');
      if(!isNote(original)&&!isImage(original))continue;let path=validPath(original);
      if(vault.notes.some(n=>!n.deleted&&n.path===path))path=path.replace(/(\.[^/.]+)$/,` (import ${crypto.randomUUID().slice(0,6)})$1`);
      await vault.create(path,isImage(path)?toBase64(bytes):strFromU8(bytes));
    }
  }
  if(!selectedId)selectedId=notes[0]?.id||'';uiError='';menu=false;queueMicrotask(refreshEditor);
}
async function addImage(file:File|undefined){if(!file||!selected)return;const target=selectedId;const filename=await vault.image(file);refreshEditor();if(target===selectedId)api()?.insertImage(filename);}
async function onMessage(event:MessageEvent){
  if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.source!=='futo-editor')return;
  const message=event.data.message;
  try{
    if(message.type==='ready'){
      if(message.version!==9)throw new Error('The editor bridge changed. Reload or rebuild the web client.');
      frameReady=true;editorId=selected?.id||'';editorContent=selected?.content||'';
      api().initialize(JSON.stringify({bridgeVersion:9,theme:dark?'dark':'light',noteId:editorId,content:editorContent,nativeToolbar:true,contentPaddingInlinePx:32,languageTag:'en'}));refreshEditor();
    }else if(message.type==='documentLoaded'){if(message.noteId===editorId)generation=message.generation;}
    else if(message.type==='edited'){if(message.noteId===editorId){generation=message.generation;editorBusy=true;lastActivity=Date.now();}}
    else if(message.type==='change'){
      if(message.noteId===editorId){editorContent=message.content;generation=message.generation;editorBusy=false;}
      await vault.edit(message.noteId,message.content);
      if(message.flushToken){const waiter=flushes.get(message.flushToken);if(waiter){clearTimeout(waiter.timer);flushes.delete(message.flushToken);waiter.resolve();}}
    }else if(message.type==='flushFailed'){
      const waiter=flushes.get(message.flushToken);if(waiter){clearTimeout(waiter.timer);flushes.delete(message.flushToken);waiter.reject(new Error('The editor could not save. Export your notes before closing.'));}
    }else if(message.type==='openNote'){const note=notes.find(n=>n.path.replace(/\.md$/i,'')===message.id);if(note)await select(note);}
    else if(message.type==='pickImage'){imageInput?.click();}
    else if(message.type==='saveImageData'){await addImage(new File([fromBase64(message.data)],`paste.${message.ext}`,{type:mime(`paste.${message.ext}`)}));}
    else if(message.type==='openUrl'){const url=new URL(message.url);if(['https:','http:','mailto:'].includes(url.protocol))window.open(url,'_blank','noopener,noreferrer');}
  }catch(error){fail(error);}
}
onMount(()=>{
  theme();window.addEventListener('message',onMessage);
  const activity=()=>{lastActivity=Date.now();};window.addEventListener('pointerdown',activity);window.addEventListener('keydown',activity);
  const unload=(event:BeforeUnloadEvent)=>{if(editorBusy||vault.pendingDisk){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);
  const online=()=>void vault.sync();window.addEventListener('online',online);
  const hidden=()=>{if(document.hidden&&unlocked)void action(flush);};document.addEventListener('visibilitychange',hidden);
  const idle=setInterval(()=>{if(unlocked&&Date.now()-lastActivity>15*60*1000)void action(lock);},15000);
  return()=>{clearInterval(idle);window.removeEventListener('message',onMessage);window.removeEventListener('pointerdown',activity);window.removeEventListener('keydown',activity);window.removeEventListener('beforeunload',unload);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',hidden);releaseTab?.();};
});
</script>

{#if !unlocked}
<main class="login">
  <div class="login-brand"><span class="brand-icon"><Icon name="note" size={26}/></span><span>Notes</span></div>
  <form class="unlock-card" onsubmit={unlock}>
    <span class="eyebrow">YOUR PRIVATE SPACE</span><h1>A little room<br>for your thoughts.</h1>
    <p>Open your notes with the same sync password<br class="desktop-only"> you use on your phone.</p>
    <label for="password">Sync password</label>
    <div class="password-field"><Icon name="lock"/><input id="password" type="password" bind:value={password} autocomplete="current-password" required disabled={busy} placeholder="Enter your password"/></div>
    {#if loginError}<p class="form-error" role="alert">{loginError}</p>{/if}
    <button class="primary unlock-button" type="submit" disabled={busy}>{busy?'Opening your notes…':'Unlock notes'}<span>→</span></button>
    <div class="privacy-note"><Icon name="lock" size={14}/><span>Encrypted on your device. Stored on your server.</span></div>
  </form>
  <footer>Personal browser client for FUTO Notes · <a href="/web/FUTO-LICENSE.md">License</a></footer>
</main>
{:else}
<main class:show-editor={mobileEditor} class="workspace">
  <aside class="sidebar">
    <header class="sidebar-heading"><div class="wordmark"><span class="brand-icon"><Icon name="note" size={21}/></span>Notes</div><button class="icon-button" title="New note" aria-label="New note" onclick={()=>action(newNote)}><Icon name="plus" size={22}/></button></header>
    <label class="search"><Icon name="search" size={17}/><input aria-label="Search notes" placeholder="Search your notes" bind:value={search}/>{#if search}<button aria-label="Clear search" onclick={()=>search=''}>×</button>{/if}</label>
    <div class="filters"><button class:active={!folder&&!tag} onclick={()=>{folder='';tag='';}}><Icon name="note" size={15}/>All notes <span>{notes.length}</span></button>{#if folders.length}<label class="folder-filter"><Icon name="folder" size={15}/><select aria-label="Filter by folder" bind:value={folder} onchange={()=>tag=''}><option value="">All folders</option>{#each folders as item}<option value={item}>{item}</option>{/each}</select></label>{/if}</div>
    {#if tags.length}<div class="tag-list">{#each tags.slice(0,12) as item}<button class:active={tag===item} onclick={()=>{tag=tag===item?'':item;folder='';}}>#{item}</button>{/each}</div>{/if}
    <div class="list-heading"><span>{search?'SEARCH RESULTS':tag?'TAGGED NOTES':folder||'YOUR NOTES'}</span><span>{visible.length}</span></div>
    <nav class="note-list" aria-label="Notes">
      {#each visible as note (note.id)}<button class="note-card" class:selected={selectedId===note.id} onclick={()=>action(()=>select(note))}><div class="note-title">{title(note)}</div><p>{excerpt(note)}</p><div class="note-meta"><span>{date(note.modified)}{#if note.path.includes('/')} · {note.path.slice(0,note.path.lastIndexOf('/'))}{/if}</span>{#if note.dirty}<span class="pending-dot" title="Waiting to sync"></span>{/if}</div></button>{/each}
      {#if !visible.length}<div class="empty-list">{search?'No notes match your search.':'A fresh page awaits.'}<button onclick={()=>action(newNote)}>Create a note</button></div>{/if}
    </nav>
    <footer class="sidebar-footer"><button class="sync-status" onclick={()=>action(()=>vault.sync())} title="Sync now"><span class="status-dot" class:offline={status==='offline'||status==='error'}></span>{status==='saved'?'All changes saved':status==='saving'?'Saving…':status==='offline'?'Saved offline':'Sync needs attention'}</button><div><button class="icon-button" aria-label="Toggle dark mode" title="Toggle dark mode" onclick={()=>{dark=!dark;theme();}}><Icon name="sun" size={17}/></button><button class="icon-button" aria-label="Lock notes" title="Lock notes" onclick={()=>action(lock)}><Icon name="lock" size={17}/></button></div></footer>
  </aside>
  <section class="document-pane">
    <header class="document-heading"><div class="document-location"><button class="icon-button back-button" aria-label="Back to notes" onclick={()=>mobileEditor=false}><Icon name="back"/></button><Icon name="folder" size={15}/><span>{selected?.path.includes('/')?selected.path.slice(0,selected.path.lastIndexOf('/')):'All notes'}</span></div><div class="document-actions"><button class="subtle" onclick={()=>action(newNote)}><Icon name="plus" size={16}/><span>New note</span></button><div class="menu-container"><button class="icon-button" aria-label="Note actions" title="Note actions" onclick={()=>menu=!menu}><Icon name="more"/></button>{#if menu}<div class="dropdown">{#if selected}<button onclick={()=>{name=selected!.path.replace(/\.md$/i,'');dialog='rename';menu=false;}}>Rename / move</button><button onclick={()=>action(async()=>{await flush();download(selected!.path.split('/').pop()!,new Blob([selected!.content],{type:'text/markdown'}));menu=false;})}>Download this note</button><button class="danger" onclick={()=>{dialog='delete';menu=false;}}>Delete note</button><hr>{/if}<button onclick={()=>action(exportAll)}>Export all notes (.zip)</button><button onclick={()=>{importInput?.click();menu=false;}}>Import Markdown / ZIP</button><hr><button onclick={()=>{dialog='about';menu=false;}}>About & browser storage</button></div>{/if}</div></div></header>
    {#if uiError||error||notice}<div class="notice-bar" class:error={Boolean(uiError||error)} role={uiError||error?'alert':'status'}><span>{uiError||error||notice}</span><button aria-label="Dismiss message" onclick={()=>{uiError='';vault.error='';vault.notice='';revision++;}}>×</button></div>{/if}
    {#if selected}
      <div class="title-area"><span class="eyebrow">{date(selected.modified)} · {selected.content.trim()?selected.content.trim().split(/\s+/).length:0} words</span><button class="document-title" title="Rename note" onclick={()=>{name=selected.path.replace(/\.md$/i,'');dialog='rename';}}>{title(selected)}</button></div>
      <div class="format-toolbar" aria-label="Formatting"><button title="Bold" aria-label="Bold" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('bold')}><b>B</b></button><button title="Italic" aria-label="Italic" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('italic')}><i>I</i></button><button title="Heading" aria-label="Heading" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('heading-1')}>H₁</button><span></span><button title="Bullet list" aria-label="Bullet list" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('bullet-list')}>≡</button><button title="Checklist" aria-label="Checklist" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('task-list')}><Icon name="check" size={17}/></button><button title="Link" aria-label="Link" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('link')}>↗</button><button title="Insert image" aria-label="Insert image" onclick={()=>imageInput?.click()}><Icon name="image" size={17}/></button><span></span><button title="Undo" aria-label="Undo" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('undo')}>↶</button><button title="Redo" aria-label="Redo" onmousedown={e=>e.preventDefault()} onclick={()=>api()?.exec('redo')}>↷</button></div>
    {:else}<div class="empty-document"><Icon name="note" size={38}/><h1>Make space for a thought.</h1><p>A quick idea, a list, or something to remember.</p><button class="primary" onclick={()=>action(newNote)}><Icon name="plus"/>Write your first note</button></div>{/if}
    <!-- Keep the editor alive when switching notes to retain its bridge and flush outgoing edits. -->
    <iframe class="editor-frame" class:hidden={!selected} bind:this={frame} title="Note editor" src="/web/editor.html"></iframe>
    <footer class="document-footer"><span>Markdown · End-to-end encrypted</span><span>Locks after 15 minutes of inactivity</span></footer>
  </section>
</main>
<input class="hidden" type="file" bind:this={imageInput} accept="image/*" onchange={e=>action(()=>addImage(e.currentTarget.files?.[0])).finally(()=>{if(imageInput)imageInput.value='';})}/>
<input class="hidden" type="file" bind:this={importInput} accept=".md,.zip,image/*" multiple onchange={e=>action(()=>importFiles(e.currentTarget.files)).finally(()=>{if(importInput)importInput.value='';})}/>
{/if}

{#if dialog}
<div class="modal-backdrop" role="presentation"><div class="modal" use:focusModal tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  {#if dialog==='new'||dialog==='rename'}<form onsubmit={saveName}><h2 id="dialog-title">{dialog==='new'?'A new note':'Rename or move note'}</h2><p>Use a slash to place it in a folder, such as Work/Ideas.</p><label for="note-name">Note name</label><input id="note-name" bind:value={name} required maxlength="240"/><div class="modal-actions"><button type="button" onclick={()=>dialog=''}>Cancel</button><button class="primary" type="submit">{dialog==='new'?'Create note':'Save'}</button></div></form>
  {:else if dialog==='delete'}<h2 id="dialog-title">Delete this note?</h2><p>“{selected?title(selected):''}” will be deleted on all synced devices.</p><div class="modal-actions"><button onclick={()=>dialog=''}>Cancel</button><button class="danger-button" onclick={()=>action(deleteNote)}>Delete note</button></div>
  {:else}<h2 id="dialog-title">Your notes, your server.</h2><p>This personal browser client reuses FUTO Notes’ editor, modified with a browser host and local image bridge. <a href="/web/FUTO-LICENSE.md" target="_blank" rel="noreferrer">FUTO license</a>.</p><p>Your browser stores encrypted notes and pending edits. Your password and unlocked key stay in memory. Locking hides your notes and ends this browser’s server session.</p><p>Exports contain readable Markdown and images. Keep them somewhere private. The web client supports the self-hosted password vault.</p><div class="modal-actions"><button onclick={()=>action(async()=>{await flush();await vault.forget();unlocked=false;releaseTab?.();releaseTab=undefined;dialog='';})}>Forget this browser</button><button class="primary" onclick={()=>dialog=''}>Done</button></div>{/if}
  {#if uiError}<p class="form-error" role="alert">{uiError}</p>{/if}
</div></div>
{/if}
