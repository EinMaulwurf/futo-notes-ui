import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
const assets = readdirSync('dist/assets').map((file) => '/web/assets/' + file);
const file = 'dist/sw.js';
let source = readFileSync(file, 'utf8');
const version = createHash('sha256')
  .update(source + assets.join('|'))
  .digest('hex')
  .slice(0, 12);
source = source
  .replace('futo-notes-ui-v1', `futo-notes-ui-${version}`)
  .replace(
    /['"]__PRECACHE_ASSETS__['"']/,
    assets.map((a) => JSON.stringify(a)).join(','),
  );
if (source.includes('__PRECACHE_ASSETS__'))
  throw new Error('Service worker asset manifest was not generated.');
new Script(source, { filename: file });
writeFileSync(file, source);
