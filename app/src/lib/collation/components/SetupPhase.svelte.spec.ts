import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { collationState, type WitnessConfig } from '../collation-state.svelte';
import { alignmentCellFromTokens } from '../alignment-cell';
import type { WitnessSourceToken } from '../collation-types';
import SetupPhase from './SetupPhase.svelte';
import * as db from '$lib/db/client';

const mocks = vi.hoisted(() => ({ gather: vi.fn() }));
vi.mock('$lib/db/client', { spy: true });
vi.mock('$lib/project/projects', () => ({
	listTranscriptions: vi.fn(async () =>
		['A', 'B', 'C'].map(id => ({ id: `${id}-tx`, displayLabel: id, title: '', hands: [] }))
	),
}));
vi.mock('$lib/collation/gather-verses', () => ({
	gatherVerses: vi.fn(async () =>
		['John 1:1', 'John 1:2'].map(identifier => ({
			identifier,
			book: 'John',
			chapter: '1',
			verse: identifier.slice(-1),
			count: 3,
		}))
	),
}));
vi.mock('$lib/collation/collation-runner', () => ({
	gatherWitnessesForSegment: mocks.gather,
	prepareWitnessesFromDocument: vi.fn(),
	extractWitnessTokensForVerse: vi.fn(),
}));

function tokens(content: string): WitnessSourceToken[] {
	return content.split(' ').map(original => ({
		kind: 'text',
		original,
		segments: [{ text: original, hasUnclear: false, isPunctuation: false, isSupplied: false }],
		gap: null,
	}));
}

function witness(id: string, content: string): WitnessConfig {
	return {
		witnessId: id,
		siglum: id,
		transcriptionId: `${id}-tx`,
		kind: 'firsthand',
		handId: 'firsthand',
		content,
		tokens: tokens(content),
		treatment: 'full',
		isBaseText: id === 'A',
		isExcluded: false,
		overridesDefault: false,
	};
}

function gathered(texts: Record<string, string>) {
	return {
		error: null,
		orphanedMembers: [],
		witnesses: Object.entries(texts).map(([id, content]) => ({
			...witness(id, content),
			id,
			transcriptionUid: `${id}-tx`,
			source: { kind: 'version', transcriptionId: `${id}-tx`, versionId: `${id}-v2` },
		})),
	};
}

it('places on a transcription toggle and keeps the alignment through a gather error', async () => {
	vi.mocked(db.getProject).mockResolvedValue({
		id: 'project',
		name: 'Project',
		collationSettings: null,
	} as Awaited<ReturnType<typeof db.getProject>>);
	vi.mocked(db.getProjectTranscriptionIds).mockResolvedValue(['A-tx', 'B-tx']);
	vi.mocked(db.syncProjectTranscriptionIds).mockImplementation(async (_, ids) => ids);
	collationState.reset();
	await collationState.selectProject('project');
	collationState.setSegmentMember('John 1:1');
	collationState.setSegmentName('John 1:1');
	collationState.setWitnesses([witness('A', 'one two'), witness('B', 'one two')]);
	const inputs = collationState.buildCollationWitnessInputs();
	collationState.setAlignmentSnapshot({
		witnessOrder: ['A', 'B'],
		columns: [0, 1].map(index => ({
			id: `column-${index}`,
			index,
			merged: false,
			cells: inputs.map(input => [
				input.id,
				alignmentCellFromTokens(input.tokens!.slice(index, index + 1)),
			]),
		})),
	});
	collationState.mergeColumns(['column-0', 'column-1']);
	const merged = collationState.alignmentColumns.map(column => column.id);
	expect(collationState.alignmentColumns.map(column => column.merged)).toEqual([true]);
	mocks.gather.mockResolvedValue(gathered({ A: 'one two', B: 'one deux', C: 'one three' }));
	try {
		render(SetupPhase);
		await page.getByRole('checkbox', { name: 'C', exact: true }).click();
		await expect
			.poll(() => collationState.witnesses.map(witness => witness.siglum))
			.toEqual(['A', 'B', 'C']);
		expect(collationState.alignmentColumns.map(column => column.id)).toEqual(merged);
		expect(collationState.alignmentColumns[0].cells.get('B')?.text).toBe('one deux');
		mocks.gather.mockResolvedValue({
			error: {
				code: 'transcription-matches-multiple-members',
				message: 'Transcription A matches multiple members.',
			},
			orphanedMembers: [],
			witnesses: [],
		});
		await page.getByRole('button', { name: /John 1:2/ }).click();
		await expect
			.element(page.getByText('Transcription A matches multiple members.'))
			.toBeVisible();
		expect(collationState.witnesses.map(witness => witness.siglum)).toEqual(['A', 'B', 'C']);
		expect(collationState.alignmentColumns.map(column => column.id)).toEqual(merged);
	} finally {
		collationState.reset();
	}
});

it('excludes a full manual witness and makes it fragmentary at phone width', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		collationState.reset();
		collationState
			.getManualWitnesses()
			.push({ id: 'full', siglum: 'Syriac', treatment: 'full', includeInCbgm: false });
		render(SetupPhase);
		const include = page.getByRole('checkbox', { name: 'Include manual witness Syriac' });
		await expect.element(include).toBeChecked();
		await include.click();
		expect(collationState.getManualWitnessMembers()).toEqual([]);
		await include.click();
		expect(collationState.getManualWitnessMembers()).toHaveLength(1);
		const treatment = page.getByRole('combobox', {
			name: 'Treatment for manual witness Syriac',
		});
		await treatment.selectOptions('fragmentary');
		expect(collationState.getManualWitnessMembers()).toEqual([]);
		expect(collationState.getManualWitnessOverride('full')).toEqual({
			manualWitnessId: 'full',
			isExcluded: false,
			treatment: 'fragmentary',
		});
		await expect
			.poll(() =>
				[
					...document.querySelectorAll<HTMLElement>(
						'section[aria-label="Manual witnesses"] input, section[aria-label="Manual witnesses"] select'
					),
				].every(element => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= 390;
				})
			)
			.toBe(true);
	} finally {
		collationState.reset();
		await page.viewport(original.width, original.height);
	}
});
