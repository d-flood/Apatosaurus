import { describe, expect, it } from 'vitest';

import {
	classifyDocumentPath,
	documentCanonicalPath,
	documentVersionPath,
	isCoveredByDeletionPaths,
} from './document-files';
import { tombstonedProjectPaths, type TombstonePayload } from './formats';

describe('document files', () => {
	it('builds canonical and version paths', () => {
		expect(documentCanonicalPath('transcription', 'pt-1')).toBe('transcriptions/pt-1.tei.xml');
		expect(documentVersionPath('collation', 'col-1', 'v-1')).toBe(
			'history/collations/col-1/v-1.tei.xml'
		);
	});

	it('classifies document paths', () => {
		expect(classifyDocumentPath('transcriptions/pt-1.json')).toEqual({
			role: 'legacy',
			kind: 'transcription',
			entityId: 'pt-1',
		});
		expect(classifyDocumentPath('collations/col-1.json')).toEqual({
			role: 'legacy',
			kind: 'collation',
			entityId: 'col-1',
		});
		expect(classifyDocumentPath('transcriptions/pt-1.tei.xml')).toEqual({
			role: 'unlisted',
			kind: 'transcription',
			entityId: 'pt-1',
		});
		expect(classifyDocumentPath('collations/col-1.working.json')).toEqual({
			role: 'legacy',
			kind: 'collation',
			entityId: 'col-1',
		});
		expect(classifyDocumentPath('history/collations/col-1/v-1.json')).toEqual({
			role: 'legacy',
			kind: 'collation',
			entityId: 'col-1',
			versionId: 'v-1',
		});
		expect(classifyDocumentPath('history/transcriptions/pt-1/v-1.tei.xml')).toEqual({
			role: 'version',
			kind: 'transcription',
			entityId: 'pt-1',
			versionId: 'v-1',
		});
		expect(
			classifyDocumentPath(
				'transcriptions/pt-1.tei.xml',
				new Set(['transcriptions/pt-1.tei.xml'])
			)
		).toEqual({ role: 'canonical', kind: 'transcription', entityId: 'pt-1' });
	});

	it('returns null for tombstones, CBGM files and unrelated paths', () => {
		for (const path of [
			'tombstones/project-transcription--pt-1.json',
			'cbgm/an-1.json',
			'cbgm/an-1.input.xml',
			'cbgm/an-1.sqlite',
			'cbgm/an-1.global-stemma.dot',
			'project.json',
			'transcriptions/.json',
			'transcriptions/nested/pt-1.json',
			'notes/pt-1.tei.xml',
		]) {
			expect(classifyDocumentPath(path)).toBeNull();
		}
	});

	it('tombstones a transcription by its canonical file and whole history folder', () => {
		const tombstone = (cloud_path: string) =>
			({
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				cloud_path,
			}) as TombstonePayload;
		const tei = tombstonedProjectPaths(tombstone('transcriptions/pt-1.tei.xml'));
		expect(tei).toEqual(['transcriptions/pt-1.tei.xml', 'history/transcriptions/pt-1/']);
		expect(tombstonedProjectPaths(tombstone('transcriptions/pt-1.json'))).toEqual([
			'transcriptions/pt-1.json',
			'transcriptions/pt-1.tei.xml',
			'history/transcriptions/pt-1/',
		]);
		expect(isCoveredByDeletionPaths(tei, 'history/transcriptions/pt-1/v-1.tei.xml')).toBe(true);
		expect(isCoveredByDeletionPaths(tei, 'history/transcriptions/pt-10/v-1.tei.xml')).toBe(
			false
		);
		expect(isCoveredByDeletionPaths(tei, 'transcriptions/pt-1.json')).toBe(false);
	});
});
