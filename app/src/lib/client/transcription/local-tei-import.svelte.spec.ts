import { describe, expect, it } from 'vitest';

import { prepareLocalTeiImport, selectTeiFiles } from './local-tei-import';

const defaults = {
	transcriber: 'Default Transcriber',
	repository: 'Default Repository',
	settlement: 'Default Settlement',
	language: 'lat',
};

function tei(header: string) {
	return `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>${header}</fileDesc></teiHeader><text><body><pb n="1r"/><cb n="1"/><lb n="1"/><w>λογος</w></body></text></TEI>`;
}

describe('prepareLocalTeiImport', () => {
	it('prefers TEI header metadata over defaults', () => {
		const prepared = prepareLocalTeiImport(
			'rom.xml',
			tei(
				'<titleStmt><title type="document">Romans in 01</title><respStmt><resp>Transcribed by</resp><name>INTF</name></respStmt></titleStmt><sourceDesc><msDesc><msIdentifier><settlement>London</settlement><repository>British Library</repository><idno>01</idno></msIdentifier></msDesc></sourceDesc>'
			),
			defaults
		);

		expect(prepared.metadata).toEqual({
			title: 'Romans in 01',
			siglum: '01',
			transcriber: 'INTF',
			repository: 'British Library',
			settlement: 'London',
			language: 'lat',
		});
		expect(prepared.duplicateKey).toBe('01');
	});

	it('falls back to the file name and defaults when the header is sparse', () => {
		const prepared = prepareLocalTeiImport('P46.xml', tei('<titleStmt/>'), defaults);

		expect(prepared.metadata).toEqual({ title: 'P46', siglum: 'P46', ...defaults });
	});

	it('throws on malformed XML', () => {
		expect(() => prepareLocalTeiImport('bad.xml', '<TEI><teiHeader>', defaults)).toThrow();
	});
});

describe('selectTeiFiles', () => {
	it('keeps XML files sorted by path', () => {
		const files = [
			new File([''], 'b.XML'),
			new File([''], 'notes.txt'),
			new File([''], 'a.xml'),
		];

		expect(selectTeiFiles(files).map(file => file.name)).toEqual(['a.xml', 'b.XML']);
	});
});
