import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTranscriptionsByIds, getVerseIndexRowsForVerse } = vi.hoisted(() => ({
	getTranscriptionsByIds: vi.fn(),
	getVerseIndexRowsForVerse: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	getTranscriptionsByIds,
}));

vi.mock('$lib/client/transcription/verse-index', () => ({
	getVerseIndexRowsForVerse,
	normalizeVerseIdentifier: (verse: { book: string; chapter: string; verse: string }) =>
		`${verse.book} ${verse.chapter}:${verse.verse}`,
}));

import { gatherWitnessesForSegment, gatherWitnessesForVerse } from './collation-runner';

interface Passage {
	book: string;
	chapter: string;
	verse: string;
	text: string;
}

function makeTranscription(id: string, siglum: string, passages: Passage[]) {
	return {
		id,
		siglum,
		current_revision_id: `${id}-revision`,
		content_json: JSON.stringify({
			type: 'transcriptionDocument',
			pages: [
				{
					columns: [
						{
							lines: [
								{
									items: passages.flatMap(passage => [
										{
											type: 'milestone',
											kind: 'verse',
											attrs: {
												book: passage.book,
												chapter: passage.chapter,
												verse: passage.verse,
											},
										},
										{ type: 'text', text: passage.text },
									]),
								},
							],
						},
					],
				},
			],
		}),
	};
}

describe('gatherWitnessesForVerse', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getVerseIndexRowsForVerse.mockResolvedValue([
			{ transcription_id: 'tx-2' },
			{ transcription_id: 'tx-1' },
			{ transcription_id: 'tx-2' },
		]);
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Gr. 1992',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					header: {
						titles: [
							{
								text: 'GA 2495',
								type: 'document',
								n: '2495',
								key: '32495',
							},
						],
						msDescription: {
							msName: '2495',
						},
					},
					teiHeader: {
						type: 'element',
						tag: 'teiHeader',
						children: [
							{
								type: 'element',
								tag: 'fileDesc',
								children: [
									{
										type: 'element',
										tag: 'sourceDesc',
										children: [
											{
												type: 'element',
												tag: 'msDesc',
												children: [
													{
														type: 'element',
														tag: 'msIdentifier',
														children: [
															{
																type: 'element',
																tag: 'altIdentifier',
																attrs: { type: 'Liste' },
																children: [
																	{
																		type: 'element',
																		tag: 'idno',
																		children: [
																			{
																				type: 'text',
																				text: '32495',
																			},
																		],
																	},
																],
															},
														],
													},
												],
											},
										],
									},
								],
							},
						],
					},
					pages: [
						{
							columns: [
								{
									lines: [
										{
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'λογος' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
			{
				id: 'tx-2',
				siglum: 'Shelfmark 02',
				title: 'Witness 02',
				updated_at: '2026-03-13T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					pages: [
						{
							columns: [
								{
									lines: [
										{
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'θεος' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);
	});

	it('queries verse rows and transcriptions in bulk while preserving verse-index order', async () => {
		const witnesses = await gatherWitnessesForVerse('Romans 1:1', ['tx-1', 'tx-2']);

		expect(getVerseIndexRowsForVerse).toHaveBeenCalledWith('Romans 1:1', ['tx-1', 'tx-2']);
		expect(getTranscriptionsByIds).toHaveBeenCalledWith(['tx-2', 'tx-1']);
		expect(witnesses.map(witness => witness.transcriptionUid)).toEqual(['tx-2', 'tx-1']);
		expect(witnesses.map(witness => witness.id)).toEqual(['Shelfmark 02', '32495']);
		expect(witnesses.map(witness => witness.siglum)).toEqual(['Shelfmark 02', '32495']);
		expect(witnesses.map(witness => witness.content)).toEqual(['θεος', 'λογος']);
	});

	it('merges wrapped words before building gathered witness content', async () => {
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					pages: [
						{
							type: 'page',
							id: 'p1',
							columns: [
								{
									type: 'column',
									number: 1,
									lines: [
										{
											type: 'line',
											number: 1,
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'part1' },
											],
										},
										{
											type: 'line',
											number: 2,
											wrapped: true,
											items: [
												{ type: 'text', text: 'part2' },
												{ type: 'boundary', kind: 'word' },
												{ type: 'text', text: 'next' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);

		const witnesses = await gatherWitnessesForVerse('Romans 1:1', ['tx-1']);

		expect(witnesses).toHaveLength(1);
		expect(witnesses[0]?.tokens.map(token => token.original)).toEqual([
			'part1\\npart2',
			'next',
		]);
		expect(witnesses[0]?.content).toBe('part1\\npart2 next');
	});

	it('can ignore wrapped word-break markers when gathering witnesses', async () => {
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					pages: [
						{
							type: 'page',
							id: 'p1',
							columns: [
								{
									type: 'column',
									number: 1,
									lines: [
										{
											type: 'line',
											number: 1,
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'part1' },
											],
										},
										{
											type: 'line',
											number: 2,
											wrapped: true,
											items: [
												{ type: 'text', text: 'part2' },
												{ type: 'boundary', kind: 'word' },
												{ type: 'text', text: 'next' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);

		const witnesses = await gatherWitnessesForVerse('Romans 1:1', ['tx-1'], {
			ignoreWordBreaks: true,
		});

		expect(witnesses).toHaveLength(1);
		expect(witnesses[0]?.tokens.map(token => token.original)).toEqual(['part1part2', 'next']);
		expect(witnesses[0]?.content).toBe('part1part2 next');
	});

	it('builds gathered witness content with standalone punctuation tokens', async () => {
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Punct 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					pages: [
						{
							columns: [
								{
									lines: [
										{
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'λογος' },
												{
													type: 'text',
													text: ',',
													marks: [{ type: 'punctuation' }],
												},
												{ type: 'text', text: 'θεος' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);

		const witnesses = await gatherWitnessesForVerse('Romans 1:1', ['tx-1']);

		expect(witnesses).toHaveLength(1);
		expect(witnesses[0]?.tokens.map(token => token.original)).toEqual(['λογος', ',', 'θεος']);
		expect(witnesses[0]?.content).toBe('λογος, θεος');
	});

	it('does not add a false leading page marker when the target verse starts after a wrapped page break', async () => {
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					pages: [
						{
							type: 'page',
							id: 'p1',
							columns: [
								{
									type: 'column',
									number: 1,
									lines: [
										{
											type: 'line',
											number: 1,
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{ type: 'text', text: 'part1' },
											],
										},
									],
								},
							],
						},
						{
							type: 'page',
							id: 'p2',
							wrapped: true,
							columns: [
								{
									type: 'column',
									number: 1,
									wrapped: true,
									lines: [
										{
											type: 'line',
											number: 1,
											wrapped: true,
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '2',
													},
												},
												{ type: 'text', text: 'start' },
												{ type: 'boundary', kind: 'word' },
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);

		const witnesses = await gatherWitnessesForVerse('Romans 1:2', ['tx-1']);

		expect(witnesses).toHaveLength(1);
		expect(witnesses[0]?.tokens.map(token => token.original)).toEqual(['start']);
		expect(witnesses[0]?.content).toBe('start');
	});

	it('emits correctors as separate witnesses with full and fragmentary source variants', async () => {
		getTranscriptionsByIds.mockResolvedValue([
			{
				id: 'tx-1',
				siglum: 'Corrected 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				content_json: JSON.stringify({
					type: 'transcriptionDocument',
					header: {
						witnessIds: ['firsthand', 'corrector1'],
					},
					pages: [
						{
							columns: [
								{
									lines: [
										{
											items: [
												{
													type: 'milestone',
													kind: 'verse',
													attrs: {
														book: 'Romans',
														chapter: '1',
														verse: '1',
													},
												},
												{
													type: 'text',
													text: 'λογος',
													marks: [
														{
															type: 'correction',
															attrs: {
																corrections: [
																	{
																		hand: '#corrector1',
																		content: [
																			{
																				type: 'text',
																				text: 'ρημα',
																			},
																		],
																	},
																],
															},
														},
													],
												},
												{ type: 'boundary', kind: 'word' },
												{ type: 'text', text: 'θεος' },
												{ type: 'boundary', kind: 'word' },
												{
													type: 'correctionOnly',
													corrections: [
														{
															hand: '#corrector1',
															content: [
																{ type: 'text', text: 'κυριος' },
															],
														},
													],
												},
											],
										},
									],
								},
							],
						},
					],
				}),
			},
		]);

		const witnesses = await gatherWitnessesForVerse('Romans 1:1', ['tx-1']);

		expect(witnesses).toHaveLength(2);
		expect(witnesses[0]).toMatchObject({
			kind: 'firsthand',
			handId: 'firsthand',
			content: 'λογος θεος',
		});
		expect(witnesses[1]).toMatchObject({
			kind: 'corrector',
			handId: 'corrector1',
			siglum: 'Corrected 01 corrector1',
			fullContent: 'ρημα θεος κυριος',
		});
		expect(witnesses[1]?.fragmentaryTokens?.map(token => token.kind)).toEqual([
			'text',
			'untranscribed',
			'text',
		]);
		expect(witnesses[1]?.fragmentaryContent).toBe('ρημα ⊘ κυριος');
	});

	it('gathers witnesses from members using different reference conventions', async () => {
		const ignptWitness = makeTranscription('tx-ignpt', 'IGNTP 01', [
			{ book: 'IGNTP', chapter: '1', verse: '1', text: 'λογος' },
		]);
		const rpWitness = makeTranscription('tx-rp', 'RP 01', [
			{ book: 'RP', chapter: 'K1', verse: 'V1', text: 'θεος' },
		]);
		const transcriptions = [ignptWitness, rpWitness];
		getVerseIndexRowsForVerse.mockImplementation(async (identifier: string) =>
			identifier === 'IGNTP 1:1'
				? [{ transcription_id: 'tx-ignpt' }]
				: [{ transcription_id: 'tx-rp' }]
		);
		getTranscriptionsByIds.mockImplementation(async (ids: string[]) =>
			transcriptions.filter(transcription => ids.includes(transcription.id))
		);

		const result = await gatherWitnessesForSegment({ members: ['IGNTP 1:1', 'RP K1:V1'] }, [
			'tx-ignpt',
			'tx-rp',
		]);

		expect(result.error).toBeNull();
		expect(result.witnesses.map(witness => [witness.transcriptionUid, witness.siglum])).toEqual(
			[
				['tx-ignpt', 'IGNTP 01'],
				['tx-rp', 'RP 01'],
			]
		);
	});

	it('reports an orphaned member while gathering witnesses from resolved members', async () => {
		const resolvedWitness = makeTranscription('tx-resolved', 'Resolved 01', [
			{ book: 'A', chapter: '1', verse: '1', text: 'λογος' },
		]);
		const segment = { members: ['A 1:1', 'B 1:1'] };
		getVerseIndexRowsForVerse.mockImplementation(async (identifier: string) =>
			identifier === 'A 1:1' ? [{ transcription_id: 'tx-resolved' }] : []
		);
		getTranscriptionsByIds.mockResolvedValue([resolvedWitness]);

		const result = await gatherWitnessesForSegment(segment, ['tx-resolved']);

		expect(result.error).toBeNull();
		expect(result.orphanedMembers).toEqual(['B 1:1']);
		expect(result.witnesses.map(witness => witness.transcriptionUid)).toEqual(['tx-resolved']);
		expect(segment.members).toEqual(['A 1:1', 'B 1:1']);
		expect(result.witnesses[0]?.tokens.map(token => token.kind)).toEqual(['text']);
	});

	it('reports every member when all segment members are orphaned', async () => {
		const segment = { members: ['Missing A 1:1', 'Missing B 1:1'] };
		getVerseIndexRowsForVerse.mockResolvedValue([]);
		getTranscriptionsByIds.mockResolvedValue([]);

		const result = await gatherWitnessesForSegment(segment, ['tx-1']);

		expect(result.error).toBeNull();
		expect(result.orphanedMembers).toEqual(['Missing A 1:1', 'Missing B 1:1']);
		expect(result.witnesses).toEqual([]);
		expect(segment.members).toEqual(['Missing A 1:1', 'Missing B 1:1']);
	});

	it('keeps internal witness ids unique when distinct transcriptions share a siglum', async () => {
		const firstWitness = makeTranscription('tx-first', 'Shared 01', [
			{ book: 'A', chapter: '1', verse: '1', text: 'λογος' },
		]);
		const secondWitness = makeTranscription('tx-second', 'Shared 01', [
			{ book: 'B', chapter: '1', verse: '1', text: 'θεος' },
		]);
		const transcriptions = [firstWitness, secondWitness];
		getVerseIndexRowsForVerse.mockImplementation(async (identifier: string) =>
			identifier === 'A 1:1'
				? [{ transcription_id: 'tx-first' }]
				: [{ transcription_id: 'tx-second' }]
		);
		getTranscriptionsByIds.mockImplementation(async (ids: string[]) =>
			transcriptions.filter(transcription => ids.includes(transcription.id))
		);

		const result = await gatherWitnessesForSegment({ members: ['A 1:1', 'B 1:1'] }, [
			'tx-first',
			'tx-second',
		]);

		expect(result.error).toBeNull();
		expect(result.witnesses.map(witness => witness.id)).toEqual(['Shared 01', 'Shared 01#2']);
		expect(
			result.witnesses.map(witness => [
				witness.siglum,
				witness.kind,
				witness.handId,
				witness.transcriptionUid,
				witness.sourceVersion,
				witness.content,
			])
		).toEqual([
			['Shared 01', 'firsthand', 'firsthand', 'tx-first', 'tx-first-revision', 'λογος'],
			['Shared 01', 'firsthand', 'firsthand', 'tx-second', 'tx-second-revision', 'θεος'],
		]);
	});

	it('returns one witness for an exact duplicate member', async () => {
		const transcription = makeTranscription('tx-1', 'Witness 01', [
			{ book: 'A', chapter: '1', verse: '1', text: 'λογος' },
		]);
		getVerseIndexRowsForVerse.mockResolvedValue([{ transcription_id: 'tx-1' }]);
		getTranscriptionsByIds.mockResolvedValue([transcription]);

		const result = await gatherWitnessesForSegment({ members: ['A 1:1', 'A 1:1'] }, ['tx-1']);

		expect(result.error).toBeNull();
		expect(result.witnesses).toHaveLength(1);
		expect(result.witnesses[0]?.transcriptionUid).toBe('tx-1');
	});

	it('rejects a transcription that matches two distinct members without witnesses', async () => {
		const transcription = makeTranscription('tx-shared', 'Shared 01', [
			{ book: 'A', chapter: '1', verse: '1', text: 'λογος' },
			{ book: 'B', chapter: '1', verse: '1', text: 'θεος' },
		]);
		getVerseIndexRowsForVerse.mockResolvedValue([{ transcription_id: 'tx-shared' }]);
		getTranscriptionsByIds.mockResolvedValue([transcription]);

		const result = await gatherWitnessesForSegment({ members: ['A 1:1', 'B 1:1'] }, [
			'tx-shared',
		]);

		expect(result.witnesses).toEqual([]);
		expect(result.error).toMatchObject({
			code: 'transcription-matches-multiple-members',
			transcriptionId: 'tx-shared',
			members: ['A 1:1', 'B 1:1'],
		});
		expect(result.error?.message).toContain('Shared 01');
	});

	it('preserves single-member sigla and corrector hands', async () => {
		getVerseIndexRowsForVerse.mockResolvedValue([{ transcription_id: 'tx-1' }]);
		const transcription = makeTranscription('tx-1', 'Corrected 01', [
			{ book: 'Romans', chapter: '1', verse: '1', text: 'λογος' },
		]);
		const document = JSON.parse(transcription.content_json) as {
			header?: { witnessIds: string[] };
			pages: Array<{
				columns: Array<{
					lines: Array<{ items: Array<{ marks?: unknown[] }> }>;
				}>;
			}>;
		};
		document.header = { witnessIds: ['firsthand', 'corrector1'] };
		document.pages[0].columns[0].lines[0].items[1].marks = [
			{
				type: 'correction',
				attrs: {
					corrections: [
						{
							hand: '#corrector1',
							content: [{ type: 'text', text: 'ρημα' }],
						},
					],
				},
			},
		];
		transcription.content_json = JSON.stringify(document);
		getTranscriptionsByIds.mockResolvedValue([transcription]);

		const perIdentifier = await gatherWitnessesForVerse('Romans 1:1', ['tx-1']);
		const segmentResult = await gatherWitnessesForSegment({ members: ['Romans 1:1'] }, [
			'tx-1',
		]);

		expect(segmentResult.error).toBeNull();
		expect(segmentResult.witnesses).toEqual(perIdentifier);
		expect(segmentResult.witnesses.map(witness => witness.siglum)).toEqual([
			'Corrected 01',
			'Corrected 01 corrector1',
		]);
		expect(segmentResult.witnesses[1]?.handId).toBe('corrector1');
	});
});
