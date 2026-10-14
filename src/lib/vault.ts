import {Api,ApiError} from './api';
import {encrypt,decrypt,pack,unpack,unlockKey,newKeyMaterial,validPath,isNote,isImage,mime,fromBase64,toBase64,type KeyMaterial} from './crypto';
import {metadata,saveMetadata,loadCache,saveCache,forgetCache} from './storage';
export interface ServerObject {id:string;version:string|number;change_seq:string|number;deleted:boolean;blob_key?:string;updated_at?:string;}
interface Intent {id:string;path:string;content:string;deleted:boolean;version:number;remoteId?:string;}
export interface Note {
  id:string;remoteId?:string;version:number;path:string;content:string;basePath:string;baseContent:string;
  dirty:boolean;deleted:boolean;modified:number;intent?:Intent;
}
interface Snapshot {schema:1;cursor:number;notes:Note[];}
export type Status='saved'|'saving'|'offline'|'error'|'locked';
export class Vault {
  notes:Note[]=[];cursor=0;collectionId='';key:CryptoKey|null=null;material:KeyMaterial|null=null;
  status:Status='locked';error='';notice='';pendingDisk=0;stopped=false;
  api:Api;onchange:()=>void=()=>{};beforeSync:()=>Promise<void>=async()=>{};beforeRemote:()=>Promise<void>=async()=>{};
  private disk:Promise<void>=Promise.resolve();private syncing:Promise<void>|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;private poll:ReturnType<typeof setInterval>|undefined;
  private events:EventSource|undefined;
  constructor(api=new Api()){this.api=api;}
  emit(){this.onchange();}
  snapshot():Snapshot {return structuredClone({schema:1,cursor:this.cursor,notes:this.notes});}
  persist():Promise<void> {
    if(!this.key)throw new Error('Vault is locked.');
    const snapshot=this.snapshot(),key=this.key,id=this.collectionId;this.pendingDisk++;this.emit();
    const next=this.disk.catch(()=>{}).then(()=>saveCache(id,key,snapshot));
    this.disk=next;
    return next.then(()=>{this.pendingDisk--;this.emit();},error=>{this.pendingDisk--;this.status='error';this.error='Could not save in this browser. Free disk space and export your notes before closing.';this.emit();throw error;});
  }
  async unlock(password:string):Promise<void> {
    this.stopped=false;this.error='';const cachedMeta=await metadata();let meta;
    try {
      await this.api.login(password);
      const {collections}=await this.api.request('/api/collections');
      const collection=collections[0]||(await this.api.request('/api/collections',{method:'POST'})).collection;
      let {key:material}=await this.api.request(`/api/collections/${collection.id}/key`);
      if(!material){const candidate=await newKeyMaterial(password);material=(await this.api.request(`/api/collections/${collection.id}/key`,{method:'PUT',body:JSON.stringify(candidate)})).key;}
      meta={collectionId:collection.id,material:material as KeyMaterial};this.status='saving';
    } catch(error) {
      if(error instanceof ApiError || !cachedMeta)throw error;
      meta=cachedMeta;this.status='offline';
    }
    const key=await unlockKey(password,meta.material);
    // Cache is tied to this vault's key and collection; never overwrite another vault's pending edits.
    if(cachedMeta&&cachedMeta.collectionId!==meta.collectionId) throw new Error('The server vault changed. Export the old browser notes offline before clearing its storage.');
    const saved=await loadCache<Snapshot>(meta.collectionId,key);
    if(saved&&saved.schema!==1)throw new Error('Unsupported browser storage format.');
    this.key=key;this.material=meta.material;this.collectionId=meta.collectionId;
    this.notes=saved?.notes||[];this.cursor=saved?.cursor||0;await saveMetadata(meta);this.emit();
    if(this.status!=='offline')await this.sync();
    this.poll=setInterval(()=>void this.sync(),30000);
    if(!this.api.base&&typeof EventSource!=='undefined') {
      this.events=new EventSource('/api/sync/events');
      this.events.addEventListener('ready',()=>void this.sync());
      this.events.addEventListener('change',()=>void this.sync());
      this.events.onerror=()=>{if(!navigator.onLine){this.status='offline';this.emit();}};
    }
  }
  async lock():Promise<void> {
    this.stopped=true;clearTimeout(this.timer);clearInterval(this.poll);this.events?.close();
    await this.syncing;await this.disk;
    // Local offline changes remain encrypted for the next unlock.
    this.key=null;this.notes=[];this.material=null;this.status='locked';this.error='';this.emit();
    await this.api.request('/api/auth/logout',{method:'POST'}).catch(()=>{});this.api.token='';
  }
  async forget(){if(this.notes.some(n=>n.dirty||n.intent))throw new Error('Sync or export pending notes before forgetting this browser.');await this.lock();await forgetCache();}
  schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.sync(),1000);}
  async create(path:string,content=''):Promise<Note> {
    path=validPath(path);if(this.notes.some(n=>!n.deleted&&n.path===path))throw new Error('A note with that name already exists.');
    const note:Note={id:crypto.randomUUID(),version:0,path,content,basePath:'',baseContent:'',dirty:true,deleted:false,modified:Date.now()};
    this.notes.push(note);this.status='saving';await this.persist();this.schedule();return note;
  }
  async edit(id:string,content:string){
    const note=this.notes.find(n=>n.id===id);if(!note||note.deleted||content===note.content)return;
    note.content=content;note.dirty=true;note.modified=Date.now();this.status='saving';await this.persist();this.schedule();
  }
  async rename(id:string,path:string){
    validPath(path);if(this.notes.some(n=>n.id!==id&&!n.deleted&&n.path===path))throw new Error('A note with that name already exists.');
    const note=this.notes.find(n=>n.id===id)!;note.path=path;note.dirty=true;note.modified=Date.now();await this.persist();this.schedule();
  }
  async remove(id:string){const note=this.notes.find(n=>n.id===id)!;note.deleted=true;note.dirty=true;await this.persist();this.schedule();}
  async image(file:File):Promise<string>{
    if(!isImage(file.name))throw new Error('Choose a supported image file.');
    if(file.size>20*1024*1024)throw new Error('Images are limited to 20 MB in the web client.');
    const path=`image-${Date.now()}-${crypto.randomUUID().slice(0,8)}.${file.name.split('.').pop()!.toLowerCase()}`;
    await this.create(path,toBase64(new Uint8Array(await file.arrayBuffer())));return path;
  }
  imageURLs():Record<string,string>{
    const result:Record<string,string>=Object.create(null);
    for(const note of this.notes.filter(n=>!n.deleted&&isImage(n.path)))result[note.path]=URL.createObjectURL(new Blob([fromBase64(note.content)],{type:mime(note.path)}));
    return result;
  }
  private conflictCopy(note:Note){
    const stem=note.path.replace(/(\.[^/.]+)$/,''),ext=note.path.match(/(\.[^/.]+)$/)?.[1]||'.md';
    const path=`${stem} (conflict ${new Date().toISOString().replace(/[:.]/g,'-')} ${crypto.randomUUID().slice(0,6)})${ext}`;
    this.notes.push({id:crypto.randomUUID(),version:0,path,content:note.content,basePath:'',baseContent:'',dirty:true,deleted:false,modified:Date.now()});
    this.notice='Both versions were kept. Your browser edit is in a conflict copy.';
  }
  private async adopt(object:ServerObject,existing?:Note){
    if(object.deleted){
      await this.beforeRemote();
      if(existing)existing=this.notes.find(n=>n.id===existing!.id);
      if(existing){if(existing.dirty&&!existing.deleted)this.conflictCopy(existing);this.notes=this.notes.filter(n=>n!==existing);}return;
    }
    if(!object.blob_key)throw new Error('The server returned a note without its encrypted data.');
    const bytes=await this.api.request(`/api/blobs/${object.blob_key}`,{},true);
    const remote=unpack(await decrypt(this.key!,bytes));
    await this.beforeRemote();
    if(existing)existing=this.notes.find(n=>n.id===existing!.id);
    // Re-read dirty state after the network wait: typing must never be discarded.
    if(existing&&existing.dirty&&(existing.path!==remote.path||existing.content!==remote.content)&&!existing.deleted)this.conflictCopy(existing);
    if(existing?.deleted){this.notice='A newer edit prevented a deletion. The current note was kept.';}
    const collision=this.notes.find(n=>n!==existing&&!n.deleted&&n.path===remote.path);
    if(collision){
      const ext=collision.path.match(/(\.[^/.]+)$/)?.[1]||'.md';
      collision.path=collision.path.slice(0,-ext.length)+` (conflict ${crypto.randomUUID().slice(0,8)})`+ext;
      collision.dirty=true;collision.modified=Date.now();this.notice='Notes with the same name were kept separately in a conflict copy.';
    }
    const note:Note={id:existing?.id||object.id,remoteId:object.id,version:Number(object.version),path:remote.path,content:remote.content,basePath:remote.path,baseContent:remote.content,dirty:false,deleted:false,modified:Date.parse(object.updated_at||'')||Date.now()};
    if(existing){const index=this.notes.indexOf(existing);if(index!==-1)this.notes[index]=note;else this.notes.push(note);}else this.notes.push(note);
    this.emit();
  }
  private async push(note:Note){
    if(!note.dirty&&!note.intent)return;
    if(!note.remoteId&&note.deleted&&!note.intent){this.notes=this.notes.filter(n=>n!==note);await this.persist();return;}
    if(!note.intent){note.intent={id:crypto.randomUUID(),path:note.path,content:note.content,deleted:note.deleted,remoteId:note.remoteId,version:note.deleted?note.version:note.version+1};await this.persist();}
    const intent=note.intent;
    await this.persist();
    let result;
    try {
      const base=`/api/collections/${this.collectionId}`;
      const headers={'Mutation-Id':intent.id,'Content-Type':'application/octet-stream'};
      if(intent.deleted){result=await this.api.request(`${base}/objects/${intent.remoteId}?version=${intent.version}`,{method:'DELETE',headers});}
      else {
        const body=await encrypt(this.key!,pack(intent.path,intent.content));
        result=await this.api.request(`${base}/blob-objects${intent.remoteId?`/${intent.remoteId}?version=${intent.version}`:''}`,{method:intent.remoteId?'PUT':'POST',headers,body});
      }
    }catch(error){
      if(error instanceof ApiError&&(error.status===409||error.status===404)&&intent.remoteId){
        delete note.intent;
        const current=await this.api.request(`/api/collections/${this.collectionId}/objects/${intent.remoteId}`);
        await this.adopt(current.object,note);await this.persist();return;
      }
      throw error;
    }
    if(intent.deleted){
      this.notes=this.notes.filter(n=>n!==note);
    }else {
      note.remoteId=result.object.id;note.version=Number(result.object.version);note.basePath=intent.path;note.baseContent=intent.content;delete note.intent;
      note.dirty=note.deleted||note.path!==intent.path||note.content!==intent.content;
    }
    await this.persist();
  }
  sync():Promise<void>{
    if(this.stopped||!this.key)return Promise.resolve();
    if(this.syncing)return this.syncing;
    this.syncing=this.runSync().catch(error=>{this.status=error instanceof ApiError?'error':'offline';this.error=error instanceof ApiError?error.message:error instanceof TypeError?'Connection unavailable. Your edits are saved in this browser.':String(error.message||error);this.emit();}).finally(()=>{this.syncing=null;});
    return this.syncing;
  }
  private async runSync(){
    if(typeof navigator!=='undefined'&&navigator.onLine===false){this.status='offline';this.emit();return;}
    await this.beforeSync();
    this.status='saving';this.error='';this.emit();
    // Finish durable intents first, including creates whose responses were lost.
    for(const note of [...this.notes]){if(this.stopped)return;await this.push(note);}
    let more=true;
    while(more&&!this.stopped){
      const response=await this.api.request(`/api/collections/${this.collectionId}/objects?sinceVersion=${this.cursor}&limit=200`);
      for(const object of response.objects as ServerObject[]){
        const existing=this.notes.find(n=>n.remoteId===object.id);
        if(!existing||Number(object.version)>existing.version){await this.adopt(object,existing);}
        this.cursor=Math.max(this.cursor,Number(object.change_seq));await this.persist();
      }
      more=response.hasMore===true;
    }
    // Conflict copies and edits made while a write was in flight get their own durable writes.
    for(const note of [...this.notes]){if(this.stopped)return;await this.push(note);}
    this.status=this.notes.some(n=>n.dirty||n.intent)?'saving':'saved';this.error='';this.emit();
    if(this.status==='saving')this.schedule();
  }
}
export {isNote};
