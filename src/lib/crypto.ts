// FUTO self-hosted wire format: hex key envelope; IV || AES-GCM ciphertext || tag.
// Reference: crates/futo-notes-core/src/e2ee in the pinned FUTO source.
export interface KeyMaterial {
  key_salt: string;
  key_kdf: {kdf:string;iterations:number;hash?:string};
  encrypted_vault_key: string;
  key_updated_at?: string;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
export function hex(bytes: Uint8Array): string {return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export function unhex(value:string):Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('Invalid encrypted key format.');
  return Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16));
}
export function validPath(path:string):string {
  if (!path || path.length>1000 || /[\u0000-\u001f\\]/.test(path) || path.startsWith('/') || path.split('/').some(p=>!p || p==='.' || p==='..')) throw new Error('Choose a valid note name and folder.');
  return path;
}
export function pack(path:string,content:string):Uint8Array<ArrayBuffer> {
  const name=encoder.encode(validPath(path)),body=encoder.encode(content), frame=new Uint8Array(5+name.length+body.length);
  frame[0]=2;new DataView(frame.buffer).setUint32(1,name.length);frame.set(name,5);frame.set(body,5+name.length);return frame;
}
export function unpack(frame:Uint8Array):{path:string;content:string} {
  const start=frame[0]===2?5:frame[0]===0?4:0;
  if (!start || frame.length<start) throw new Error('Unsupported or truncated note format.');
  const end=start+new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getUint32(start-4);
  if (end>frame.length) throw new Error('Truncated note.');
  return {path:validPath(decoder.decode(frame.subarray(start,end))),content:decoder.decode(frame.subarray(end))};
}
export async function importKey(raw:Uint8Array<ArrayBuffer>):Promise<CryptoKey> {
  if(raw.length!==32) throw new Error('Invalid vault key.');
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encrypt(key:CryptoKey,plain:Uint8Array<ArrayBuffer>):Promise<Uint8Array<ArrayBuffer>> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const body=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  const out=new Uint8Array(12+body.length);out.set(iv);out.set(body,12);return out;
}
export async function decrypt(key:CryptoKey,encrypted:Uint8Array<ArrayBuffer>):Promise<Uint8Array<ArrayBuffer>> {
  if(encrypted.length<28) throw new Error('Truncated encrypted note.');
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.slice(0,12)},key,encrypted.slice(12)));
}
export async function passwordKey(password:string,material:KeyMaterial):Promise<CryptoKey> {
  const kdf=material.key_kdf;
  if(kdf.kdf!=='pbkdf2-sha256'||kdf.hash!=='SHA-256'||!Number.isInteger(kdf.iterations)||kdf.iterations<1||kdf.iterations>2000000) throw new Error('Unsupported vault password format.');
  const seed=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:unhex(material.key_salt),iterations:kdf.iterations,hash:'SHA-256'},seed,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function unlockKey(password:string,material:KeyMaterial):Promise<CryptoKey> {
  try {return await importKey(await decrypt(await passwordKey(password,material),unhex(material.encrypted_vault_key)));}
  catch(error) {if(error instanceof Error && error.message.startsWith('Unsupported')) throw error;throw new Error('Could not unlock the vault. Check your sync password.');}
}
export async function newKeyMaterial(password:string):Promise<KeyMaterial> {
  const material:KeyMaterial={key_salt:hex(crypto.getRandomValues(new Uint8Array(16))),key_kdf:{kdf:'pbkdf2-sha256',iterations:100000,hash:'SHA-256'},encrypted_vault_key:''};
  material.encrypted_vault_key=hex(await encrypt(await passwordKey(password,material),crypto.getRandomValues(new Uint8Array(32))));return material;
}
export async function sealJSON(key:CryptoKey,value:unknown):Promise<Uint8Array<ArrayBuffer>> {return encrypt(key,encoder.encode(JSON.stringify(value)));}
export async function openJSON<T>(key:CryptoKey,value:Uint8Array<ArrayBuffer>):Promise<T> {return JSON.parse(decoder.decode(await decrypt(key,value)));}
export function toBase64(bytes:Uint8Array):string {let text='';for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export function fromBase64(text:string):Uint8Array<ArrayBuffer> {return Uint8Array.from(atob(text),x=>x.charCodeAt(0));}
export const isNote=(path:string)=>/\.md$/i.test(path);
export const isImage=(path:string)=>/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic)$/i.test(path);
export function mime(path:string):string {const ext=path.split('.').pop()!.toLowerCase();return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',ico:'image/x-icon',avif:'image/avif',heic:'image/heic'} as Record<string,string>)[ext]||'application/octet-stream';}
