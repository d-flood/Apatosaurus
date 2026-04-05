import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIgntpCatalog } from '../src/lib/server/igntp-catalog';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const igntpRoot = path.join(appDir, 'static', 'igntp');
const outputPath = path.join(appDir, 'src', 'lib', 'igntp', 'catalog.generated.json');

const catalog = await buildIgntpCatalog(igntpRoot);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(catalog, null, '\t')}\n`, 'utf8');

console.log(
	`Generated IGNTP catalog with ${catalog.groups.length} group(s) at ${path.relative(appDir, outputPath)}`
);
