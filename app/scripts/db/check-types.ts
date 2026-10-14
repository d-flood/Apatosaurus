import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDatabaseTypes } from './render-types';

const current = readFileSync(join(process.cwd(), 'src/lib/db/types.generated.ts'), 'utf8');
if (current !== renderDatabaseTypes()) {
	console.error('Generated DB types are stale; run pnpm run db:generate.');
	process.exitCode = 1;
}
