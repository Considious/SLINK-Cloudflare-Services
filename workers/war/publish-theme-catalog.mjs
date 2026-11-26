import { execFileSync } from 'node:child_process';
import { themeCatalogText, themeCatalogObjectKey } from './theme-catalog-source.js';

if (process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH === 'main' && process.env.WRANGLER_COMMAND === 'deploy') {
  const key = await themeCatalogObjectKey();
  execFileSync('wrangler', [
    'r2', 'object', 'put', `slink-graphics-assets/${key}`,
    '--remote', '--pipe', '--content-type', 'application/json'
  ], { input:themeCatalogText, stdio:['pipe', 'inherit', 'inherit'] });
  console.log(`Published theme catalog ${key}`);
}
