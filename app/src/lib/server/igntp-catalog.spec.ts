import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildIgntpCatalog } from './igntp-catalog';

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('buildIgntpCatalog', () => {
	it('groups XML files by immediate subdirectory and sorts output', async () => {
		const rootDir = await mkdtemp(path.join(os.tmpdir(), 'igntp-catalog-'));
		tempDirectories.push(rootDir);

		await mkdir(path.join(rootDir, 'Romans_Greek_transcriptions'));
		await mkdir(path.join(rootDir, 'Acts_Greek_transcriptions'));
		await writeFile(
			path.join(rootDir, 'Romans_Greek_transcriptions', 'NT_GRC_02_Rom.xml'),
			buildTeiXml('Romans witness 02', '02'),
			'utf8'
		);
		await writeFile(
			path.join(rootDir, 'Romans_Greek_transcriptions', 'NT_GRC_01_Rom.xml'),
			buildTeiXml('Romans witness 01', '01'),
			'utf8'
		);
		await writeFile(
			path.join(rootDir, 'Acts_Greek_transcriptions', 'NT_GRC_03_Acts.xml'),
			buildTeiXml('Acts witness 03', '03'),
			'utf8'
		);
		await writeFile(path.join(rootDir, 'Acts_Greek_transcriptions', 'README.txt'), 'skip me', 'utf8');

		const catalog = await buildIgntpCatalog(rootDir);

		expect(catalog.groups.map(group => group.name)).toEqual([
			'Acts_Greek_transcriptions',
			'Romans_Greek_transcriptions',
		]);
		expect(catalog.groups[1]?.entries.map(entry => entry.fileName)).toEqual([
			'NT_GRC_01_Rom.xml',
			'NT_GRC_02_Rom.xml',
		]);
		expect(catalog.groups[0]?.entries[0]).toMatchObject({
			path: 'Acts_Greek_transcriptions/NT_GRC_03_Acts.xml',
			title: 'Acts witness 03',
			siglum: '03',
			duplicateKey: '03',
			isSupported: true,
		});
	});
});

function buildTeiXml(title: string, siglum: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader>
		<fileDesc>
			<titleStmt>
				<title type="document">${title}</title>
			</titleStmt>
			<sourceDesc>
				<msDesc>
					<msIdentifier>
						<idno>${siglum}</idno>
					</msIdentifier>
				</msDesc>
			</sourceDesc>
		</fileDesc>
	</teiHeader>
	<text>
		<body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body>
	</text>
</TEI>`;
}
