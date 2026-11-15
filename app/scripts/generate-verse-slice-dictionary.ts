import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { importTEIDocument } from '../src/lib/tei/tei-importer';
import { coerceTranscriptionDocument } from '../src/lib/transcription/content';

const DICTIONARY_BYTES = 32_768;

Object.assign(globalThis, {
	DOMParser,
	Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, CDATA_SECTION_NODE: 4, COMMENT_NODE: 8 },
});

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transcriptions = path.join(appDir, 'static', 'igntp', 'Romans_Greek_transcriptions');
const outputPath = path.join(appDir, 'src', 'lib', 'transcription', 'verse-slice-dictionary.txt');

const lines: string[] = [];
for (const file of (await readdir(transcriptions)).filter(name => name.endsWith('.xml')).sort()) {
	const document = coerceTranscriptionDocument(
		importTEIDocument(await readFile(path.join(transcriptions, file), 'utf8'))
	);
	lines.push(
		...(document?.pages ?? []).flatMap(page =>
			page.columns.flatMap(column => column.lines.map(line => JSON.stringify(line)))
		)
	);
}

const averageBytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0) / lines.length;
const step = Math.max(1, Math.floor(lines.length / (DICTIONARY_BYTES / averageBytes)));
let dictionary = '';
for (let index = 0; index < lines.length; index += step) {
	if (Buffer.byteLength(dictionary + lines[index]) > DICTIONARY_BYTES) break;
	dictionary += lines[index];
}
await writeFile(outputPath, dictionary, 'utf8');
console.log(`Wrote ${Buffer.byteLength(dictionary)} bytes to ${path.relative(appDir, outputPath)}`);
