import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const assets = readdirSync('dist/assets').map((file) => '/web/assets/' + file);
const file = 'dist/sw.js';
let source = readFileSync(file, 'utf8');
const version = createHash('sha256')
  .update(assets.join('|'))
  .digest('hex')
  .slice(0, 12);
source = source
  .replace('futo-notes-ui-v1', `futo-notes-ui-${version}`)
  .replace(
    '/* PRECACHE_ASSETS */',
    assets.map((a) => JSON.stringify(a)).join(','),
  );
writeFileSync(file, source);
