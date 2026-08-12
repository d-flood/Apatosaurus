import { readFile, writeFile } from 'node:fs/promises';
import { hashCanonicalPayload } from '../src/lib/client/store/canonical-json';
import {
	COLLATION_FIXTURE,
	collationPayloadToContent,
} from '../src/lib/client/store/formats/collation';

const fixturePath = new URL('../src/lib/client/store/formats/collation.ts', import.meta.url);
const hash = await hashCanonicalPayload(collationPayloadToContent(COLLATION_FIXTURE));
const source = await readFile(fixturePath, 'utf8');
const updated = source.replace(/(content_hash:\s*')[^']+(',)/, `$1${hash}$2`);
if (updated === source && !source.includes(`content_hash: '${hash}',`)) {
	throw new Error('Could not locate COLLATION_FIXTURE.current_revision.content_hash.');
}
await writeFile(fixturePath, updated);
console.log(hash);
