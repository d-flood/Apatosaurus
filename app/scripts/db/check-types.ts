import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './generate-types';

const generatedPath = join(process.cwd(), 'src/lib/db/types.generated.ts');
const current = readFileSync(generatedPath, 'utf8');
if (!current.trim()) {
	throw new Error('Generated DB types are empty.');
}
