import { readFile, writeFile } from 'node:fs/promises';
import { hashCanonicalPayload } from '../src/lib/storage/canonical-json';
import { collationPayloadToContent } from '../src/lib/storage/formats/collation';
import { COLLATION_FIXTURE } from '../src/lib/storage/formats/payload-fixtures';

const fixturePath = new URL('../src/lib/storage/formats/payload-fixtures.ts', import.meta.url);

function replaceInFixture(source: string, fixture: string, field: string, hash: string): string {
	const start = source.indexOf(`export const ${fixture}:`);
	const end = source.indexOf('\n};', start);
	if (start < 0 || end < 0) throw new Error(`Could not locate ${fixture}.`);
	const block = source.slice(start, end);
	const updated = block.replace(new RegExp(`(${field}:\\s*')[^']+(',)`), `$1${hash}$2`);
	if (updated === block && !block.includes(`${field}: '${hash}',`)) {
		throw new Error(`Could not locate ${fixture}.${field}.`);
	}
	return source.slice(0, start) + updated + source.slice(end);
}

const hash = await hashCanonicalPayload(collationPayloadToContent(COLLATION_FIXTURE));
let source = await readFile(fixturePath, 'utf8');
source = replaceInFixture(source, 'COLLATION_FIXTURE', 'content_hash', hash);
source = replaceInFixture(source, 'COLLATION_CHECKPOINT_FIXTURE', 'payload_content_hash', hash);
await writeFile(fixturePath, source);
console.log(hash);
