import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	ensureDjazzkitRuntime,
	getVerseIndexRowsForVerse,
	listTranscriptions,
} = vi.hoisted(() => ({
	ensureDjazzkitRuntime: vi.fn(),
	getVerseIndexRowsForVerse: vi.fn(),
	listTranscriptions: vi.fn(),
}));

function makeFilterQuery<T>(handlers: { all?: () => Promise<T[]> }) {
	const query = {
		filter: vi.fn(() => query),
		all: handlers.all,
	};
	return query;
}

vi.mock('$lib/client/djazzkit-runtime', () => ({
	ensureDjazzkitRuntime,
}));

vi.mock('$lib/client/transcription/verse-index', () => ({
	getVerseIndexRowsForVerse,
	normalizeVerseIdentifier: (verse: { book: string; chapter: string; verse: string }) =>
		`${verse.book} ${verse.chapter}:${verse.verse}`,
}));

vi.mock('$generated/models/Transcription', () => ({
	Transcription: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ all: listTranscriptions })),
		},
	},
}));

import { gatherWitnessesForVerse } from './collation-runner';

describe('gatherWitnessesForVerse', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getVerseIndexRowsForVerse.mockResolvedValue([
			{ transcription_id: 'tx-2' },
			{ transcription_id: 'tx-1' },
			{ transcription_id: 'tx-2' },
		]);
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Gr. 1992',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
																		children: [{ type: 'text', text: '32495' }],
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
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
				_djazzkit_id: 'tx-2',
				_djazzkit_deleted: false,
				siglum: 'Shelfmark 02',
				title: 'Witness 02',
				updated_at: '2026-03-13T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-13T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
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
		expect(listTranscriptions).toHaveBeenCalledTimes(1);
		expect(witnesses.map((witness) => witness.transcriptionUid)).toEqual(['tx-2', 'tx-1']);
		expect(witnesses.map((witness) => witness.id)).toEqual(['Shelfmark 02', '32495']);
		expect(witnesses.map((witness) => witness.siglum)).toEqual(['Shelfmark 02', '32495']);
		expect(witnesses.map((witness) => witness.content)).toEqual(['θεος', 'λογος']);
	});

	it('merges wrapped words before building gathered witness content', async () => {
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
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
		expect(witnesses[0]?.tokens.map((token) => token.original)).toEqual(['part1\\npart2', 'next']);
		expect(witnesses[0]?.content).toBe('part1\\npart2 next');
	});

	it('can ignore wrapped word-break markers when gathering witnesses', async () => {
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
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
		expect(witnesses[0]?.tokens.map((token) => token.original)).toEqual(['part1part2', 'next']);
		expect(witnesses[0]?.content).toBe('part1part2 next');
	});

	it('builds gathered witness content with standalone punctuation tokens', async () => {
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Punct 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
												},
												{ type: 'text', text: 'λογος' },
												{ type: 'text', text: ',', marks: [{ type: 'punctuation' }] },
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
		expect(witnesses[0]?.tokens.map((token) => token.original)).toEqual(['λογος', ',', 'θεος']);
		expect(witnesses[0]?.content).toBe('λογος, θεος');
	});

	it('does not add a false leading page marker when the target verse starts after a wrapped page break', async () => {
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Wrapped 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
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
													attrs: { book: 'Romans', chapter: '1', verse: '2' },
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
		expect(witnesses[0]?.tokens.map((token) => token.original)).toEqual(['start']);
		expect(witnesses[0]?.content).toBe('start');
	});

	it('emits correctors as separate witnesses with full and fragmentary source variants', async () => {
		listTranscriptions.mockResolvedValue([
			{
				_djazzkit_id: 'tx-1',
				_djazzkit_deleted: false,
				siglum: 'Corrected 01',
				title: 'Witness 01',
				updated_at: '2026-03-12T00:00:00.000Z',
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
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
													attrs: { book: 'Romans', chapter: '1', verse: '1' },
												},
												{
													type: 'text',
													text: 'λογος',
													marks: [
														{
															type: 'correction',
															attrs: {
																corrections: [
																	{ hand: '#corrector1', content: [{ type: 'text', text: 'ρημα' }] },
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
														{ hand: '#corrector1', content: [{ type: 'text', text: 'κυριος' }] },
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
		expect(witnesses[1]?.fragmentaryTokens?.map((token) => token.kind)).toEqual([
			'text',
			'untranscribed',
			'text',
		]);
		expect(witnesses[1]?.fragmentaryContent).toBe('ρημα ⊘ κυριος');
	});
});
