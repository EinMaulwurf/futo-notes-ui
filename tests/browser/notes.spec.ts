import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {Api} from '../../src/lib/api';
import {encrypt,pack,decrypt,unpack,unlockKey} from '../../src/lib/crypto';
const base=process.env.TEST_WEB_URL||'http://127.0.0.1:13006';
const password=process.env.TEST_PASSWORD||'browser-test-only-password';
async function mobile(){const api=new Api(base);await api.login(password);const {collections}=await api.request('/api/collections');const collection=collections[0];const {key:material}=await api.request(`/api/collections/${collection.id}/key`);return {api,id:collection.id,key:await unlockKey(password,material)};}
async function unlock(page:any){await page.getByLabel('Sync password').fill(password);await page.getByRole('button',{name:'Unlock notes'}).click();await expect(page.locator('.workspace')).toBeVisible();}
async function create(page:any,name:string){await page.getByRole('button',{name:'New note',exact:true}).first().click();await page.getByLabel('Note name').fill(name);await page.getByRole('button',{name:'Create note',exact:true}).click();await expect(page.locator('.document-title')).toHaveText(name.split('/').pop()!);await expect(page.frameLocator('iframe').locator('[contenteditable=true]').first()).toBeVisible();}
test.beforeEach(async()=>{
 if(process.env.TEST_BROWSER_CONTAINER){execFileSync('docker',['restart',process.env.TEST_BROWSER_CONTAINER],{stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}}
});
test('password, full editing, mobile sync, rename, images, export and delete',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/web/');await page.getByLabel('Sync password').fill('wrong-password');await page.getByRole('button',{name:'Unlock notes'}).click();await expect(page.getByRole('alert')).toContainText('Incorrect sync password');
 await unlock(page);await create(page,'Work/Browser note');const editor=page.frameLocator('iframe').locator('[contenteditable=true]').first();
 await editor.fill('A thought from the browser.');await expect(page.locator('.sync-status')).toContainText('All changes saved',{timeout:20000});
 const peer=await mobile();let remote:any;
 await expect.poll(async()=>{const {objects}=await peer.api.request(`/api/collections/${peer.id}/objects?sinceVersion=0`);remote=objects.find((o:any)=>!o.deleted);if(!remote)return '';return unpack(await decrypt(peer.key,await peer.api.request(`/api/blobs/${remote.blob_key}`,{},true))).content;}).toContain('A thought from the browser.');
 await peer.api.request(`/api/collections/${peer.id}/blob-objects/${remote.id}?version=${Number(remote.version)+1}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Mutation-Id':crypto.randomUUID()},body:await encrypt(peer.key,pack('Work/Browser note.md','A thought from Android.'))});
 await expect(editor).toContainText('A thought from Android.',{timeout:20000});
 await page.locator('.document-title').click();await page.getByLabel('Note name').fill('Personal/Renamed note');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.document-title')).toHaveText('Renamed note');
 await page.locator('input[type=file]').first().setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=','base64')});
 await expect(page.frameLocator('iframe').locator('img')).toHaveCount(1);await expect.poll(()=>page.frameLocator('iframe').locator('img').evaluate((image:any)=>image.complete&&image.naturalWidth>0)).toBe(true);
 await page.getByLabel('Note actions').click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export all notes (.zip)'}).click();expect((await downloadPromise).suggestedFilename()).toMatch(/notes-.*\.zip/);
 await page.getByLabel('Search notes').fill('Android');await expect(page.locator('.note-card')).toHaveCount(1);await page.getByLabel('Clear search').click();
 await page.screenshot({path:'.research/desktop.png',fullPage:true});
 const cache=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('futo-notes-web');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return new Promise<string>((resolve,reject)=>{const req=db.transaction('vault').objectStore('vault').getAll();req.onsuccess=()=>resolve(JSON.stringify(req.result));req.onerror=()=>reject(req.error);});});expect(cache).not.toContain('Android');expect(cache).not.toContain(password);
 await page.getByLabel('Note actions').click();await page.getByRole('button',{name:'Delete note',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete note',exact:true}).click();await expect(page.locator('.note-card')).toHaveCount(0);
 await page.getByLabel('Lock notes').click();await expect(page.getByRole('button',{name:'Unlock notes'})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('offline edits survive reload, then synchronize after reconnect',async({page,context})=>{
 await page.goto('/web/');await unlock(page);await create(page,'Offline note');const editor=page.frameLocator('iframe').locator('[contenteditable=true]').first();await editor.fill('Before offline');await expect(page.locator('.sync-status')).toContainText('All changes saved',{timeout:20000});
 await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await context.setOffline(true);await editor.fill('An offline edit that must survive.');await expect(page.locator('.sync-status')).toContainText('Saved offline',{timeout:20000});
 await page.reload();await unlock(page);await expect(page.frameLocator('iframe').locator('[contenteditable=true]').first()).toContainText('An offline edit that must survive.');
 await context.setOffline(false);await expect(page.locator('.sync-status')).toContainText('All changes saved',{timeout:20000});
 const peer=await mobile();const {objects}=await peer.api.request(`/api/collections/${peer.id}/objects?sinceVersion=0`);expect(unpack(await decrypt(peer.key,await peer.api.request(`/api/blobs/${objects[0].blob_key}`,{},true))).content).toContain('An offline edit that must survive.');
});
test('mobile layout and multiple-tab protection',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/web/');await unlock(page);await create(page,'Pocket note');await expect(page.locator('.sidebar')).not.toBeVisible();await page.screenshot({path:'.research/mobile.png',fullPage:true});
 await page.getByLabel('Back to notes').click();await expect(page.locator('.sidebar')).toBeVisible();await expect(page.locator('.document-pane')).not.toBeVisible();
 const second=await context.newPage();await second.goto('/web/');await second.getByLabel('Sync password').fill(password);await second.getByRole('button',{name:'Unlock notes'}).click();await expect(second.getByRole('alert')).toContainText('another tab');
 await page.getByLabel('Lock notes').click();await unlock(second);await second.close();
});
