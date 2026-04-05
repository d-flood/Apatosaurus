import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DOMParser } from '@xmldom/xmldom';

import { buildTranscriptionDuplicateKey, normalizeTranscriptionDuplicateValue } from '../igntp/duplicate-key';
import type { IgntpCatalog, IgntpCatalogEntry, IgntpCatalogGroup } from '../igntp/types';
import { importTEIDocument } from '../tei/tei-importer';

if (typeof globalThis.DOMParser === 'undefined') {
	globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
}

if (typeof globalThis.Node === 'undefined') {
	globalThis.Node = {
		ELEMENT_NODE: 1,
		TEXT_NODE: 3,
	} as typeof globalThis.Node;
}

export async function buildIgntpCatalog(rootDir: string): Promise<IgntpCatalog> {
	const directoryEntries = await readdir(rootDir, { withFileTypes: true });
	const groups: IgntpCatalogGroup[] = [];

	for (const directory of directoryEntries.filter(entry => entry.isDirectory()).sort(byName)) {
		const directoryPath = path.join(rootDir, directory.name);
		const groupEntries = await readdir(directoryPath, { withFileTypes: true });
		const entries: IgntpCatalogEntry[] = [];

		for (const file of groupEntries.filter(entry => entry.isFile() && /\.xml$/i.test(entry.name)).sort(byName)) {
			const filePath = path.join(directoryPath, file.name);
			const xml = await readFile(filePath, 'utf8');
			const metadata = extractCatalogMetadata(xml);
			const title = metadata.title || stripExtension(file.name);
			const siglum = metadata.siglum || '';
			const duplicateKey =
				buildTranscriptionDuplicateKey({ siglum, title }) ||
				normalizeTranscriptionDuplicateValue(file.name);
			const supportCheck = checkIgntpSupport(xml);

			entries.push({
				directory: directory.name,
				fileName: file.name,
				path: path.posix.join(directory.name, file.name),
				title,
				siglum,
				duplicateKey,
				isSupported: supportCheck.isSupported,
				unsupportedReason: supportCheck.unsupportedReason,
			});
		}

		if (entries.length > 0) {
			groups.push({
				name: directory.name,
				entries,
			});
		}
	}

	return {
		generatedAt: new Date().toISOString(),
		groups,
	};
}

function extractCatalogMetadata(xml: string): { title: string; siglum: string } {
	const parser = new DOMParser();
	const document = parser.parseFromString(xml, 'application/xml');
	const titleElements = getElements(document, 'title');
	const preferredTitle =
		titleElements.find(element => element.getAttribute('type') === 'document') ||
		titleElements.find(element => element.getAttribute('type') === 'short') ||
		titleElements[0];
	const msIdentifier = getElements(document, 'msIdentifier')[0];
	const siglum = msIdentifier ? getElements(msIdentifier, 'idno')[0]?.textContent?.trim() || '' : '';

	return {
		title: preferredTitle?.textContent?.trim() || '',
		siglum,
	};
}

function checkIgntpSupport(xml: string): { isSupported: boolean; unsupportedReason?: string } {
	try {
		importTEIDocument(xml);
		return { isSupported: true };
	} catch (error) {
		return {
			isSupported: false,
			unsupportedReason: error instanceof Error ? error.message : 'Unsupported TEI structure',
		};
	}
}

function getElements(parent: Document | Element, tagName: string): Element[] {
	const matches: Element[] = [];
	const elements = parent.getElementsByTagName(tagName);
	for (let index = 0; index < elements.length; index += 1) {
		const element = elements.item(index);
		if (element) matches.push(element);
	}
	return matches;
}

function stripExtension(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '');
}

function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name);
}
