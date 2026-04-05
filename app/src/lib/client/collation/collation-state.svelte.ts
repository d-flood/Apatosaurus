import { Collation } from '$generated/models/Collation';
import { CollationArtifact } from '$generated/models/CollationArtifact';
import { CollationReading } from '$generated/models/CollationReading';
import { CollationReadingWitness } from '$generated/models/CollationReadingWitness';
import { CollationToken } from '$generated/models/CollationToken';
import { CollationVariationUnit } from '$generated/models/CollationVariationUnit';
import { CollationWitness } from '$generated/models/CollationWitness';
import { Project } from '$generated/models/Project';
import { Transcription } from '$generated/models/Transcription';
import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import {
	cloneAlignmentColumn,
	deserializeAlignmentColumns,
	type AlignmentCell,
	type AlignmentColumn,
	type AlignmentSnapshot,
	type SerializedAlignmentColumn,
} from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	buildCollationDocument,
	hydrateCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
} from './collation-document';
import { buildCollationProjection } from './collation-projection';
import { gatherWitnessesForVerse, type PreparedWitness } from './collation-runner';
import type {
	AlignmentCellKind,
	AlignmentDisplayMode,
	AlignmentLayout,
	ClassifiedReading,
	CollationPhase,
	GapMetadata,
	ReadingClassification,
	RegularizationRule,
	RegularizationType,
	RegularizedToken,
	StemmaEdge,
	SuppliedTextMode,
	WitnessConfig,
	WitnessSourceToken,
	WitnessTreatment,
} from './collation-types';
import {
	buildReadingFamilyGroups,
	buildVariationUnitSpans,
	indexToReadingLabel,
	readingText,
	type ReadingFamilyGroup,
	type VariationUnitSpan,
} from './collation-variation-units';
import type { CollationTokenInput, CollationWitnessInput } from './collation-worker-types';
import type { AggregatedVerse } from './gather-verses';
import {
	createProjectCollationSettings,
	mergeProjectRules,
	parseProjectCollationSettings,
} from './project-settings';
import { isPunctuationToken, joinTokenTexts, tokenizeDisplayText } from './token-text';

const PHASE_ORDER: CollationPhase[] = [
	'setup',
	'regularization',
	'alignment',
	'readings',
	'stemma',
];
const WORKSPACE_ARTIFACT_TYPE = 'workspace_state_v2';
const LEGACY_WORKSPACE_ARTIFACT_TYPE = 'workspace_state_v1';

export type ReadingEditorType = 'none' | 'om' | 'lac' | 'ns';

export type { CollationPhase, StemmaEdge, WitnessConfig, WitnessTreatment };

export interface StemmaNode {
	readingId: string;
	x: number;
	y: number;
}

export interface DisplayedColumnSlot {
	columnId: string;
	columnIndex: number;
	start: number;
	end: number;
}

export interface ReadingFamilyView {
	id: string;
	familyKey: string;
	parent: ClassifiedReading;
	children: ClassifiedReading[];
	members: ClassifiedReading[];
}

export interface ReadingDisplayValue {
	sourceOriginalText: string | null;
	sourceNormalizedText: string | null;
	originalDisplayText: string;
	regularizedDisplayText: string;
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

interface CommandEntry {
	type: string;
	undo: () => void;
	redo: () => void;
	description: string;
}

interface WorkspaceSnapshot {
	version: 2;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	selectedVerse: AggregatedVerse | null;
	selectedBook: string;
	selectedChapter: string;
	selectedVerseNum: string;
	witnesses: WitnessConfig[];
	rules: RegularizationRule[];
	alignmentColumns: SerializedAlignmentColumn[];
	witnessOrder: string[];
	selectedUnitIndex: number;
	classifiedReadings: Array<[string, ClassifiedReading[]]>;
	stemmaEdges: Array<[string, StemmaEdge[]]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

function coerceRegularizationType(value: unknown): RegularizationType {
	return value === 'ns' ? 'ns' : 'none';
}

function createCollationState() {
	let phase = $state<CollationPhase>('setup');
	let furthestPhase = $state<CollationPhase>('setup');
	let saveStatus = $state<SaveStatus>('saved');
	let collationId = $state<string | null>(null);
	let projectId = $state<string | null>(null);
	let projectName = $state<string | null>(null);
	let workspaceArtifactId = $state<string | null>(null);
	let isLoading = $state(false);

	// Phase 1: Setup
	let selectedVerse = $state<AggregatedVerse | null>(null);
	let witnesses = $state<WitnessConfig[]>([]);
	let selectedBook = $state('');
	let selectedChapter = $state('');
	let selectedVerseNum = $state('');

	// Phase 2: Regularization
	let rules = $state<RegularizationRule[]>([]);
	let regularizedTexts = $state<Map<string, RegularizedToken[]>>(new Map());
	let lowercase = $state(false);
	let ignoreWordBreaks = $state(false);
	let ignoreTokenWhitespace = $state(true);
	let ignorePunctuation = $state(false);
	let suppliedTextMode = $state<SuppliedTextMode>('clear');
	let segmentation = $state(true);
	let transcriptionWitnessTreatments = $state<Map<string, WitnessTreatment>>(new Map());
	let transcriptionWitnessExcludedHands = $state<Map<string, string[]>>(new Map());

	// Phase 3: Alignment
	let alignmentColumns = $state<AlignmentColumn[]>([]);
	let witnessOrder = $state<string[]>([]);
	let selectedColumnIds = $state<Set<string>>(new Set());
	let selectedCells = $state<Set<string>>(new Set());
	let focusedColumn = $state<number>(-1);
	let focusedRow = $state<number>(-1);
	let alignmentDisplayMode = $state<AlignmentDisplayMode>('regularized');
	let alignmentLayout = $state<AlignmentLayout>('grid');

	// Phase 4: Stemma
	let selectedUnitIndex = $state<number>(0);
	let classifiedReadings = $state<Map<string, ClassifiedReading[]>>(new Map());
	let stemmaEdges = $state<Map<string, StemmaEdge[]>>(new Map());
	let stemmaNodes = $state<Map<string, StemmaNode[]>>(new Map());

	// Command stack for undo/redo
	let commandHistory: CommandEntry[] = [];
	let commandIndex = -1;

	function normalizeLegacyPhase(p: CollationPhase): CollationPhase {
		return p === 'regularization' ? 'alignment' : p;
	}

	function applyLegacySnapshot(snap: WorkspaceSnapshot) {
		phase = normalizeLegacyPhase(snap.phase);
		furthestPhase = normalizeLegacyPhase(snap.furthestPhase);
		selectedVerse = snap.selectedVerse;
		selectedBook = snap.selectedBook ?? '';
		selectedChapter = snap.selectedChapter ?? '';
		selectedVerseNum = snap.selectedVerseNum ?? '';
		witnesses = snap.witnesses ?? [];
		rules = (snap.rules ?? []).map(rule => ({
			...rule,
			type: coerceRegularizationType((rule as { type?: unknown }).type),
		}));
		alignmentColumns = deserializeAlignmentColumns(snap.alignmentColumns ?? []);
		witnessOrder = snap.witnessOrder ?? [];
		selectedUnitIndex = normalizeVariationUnitIndex(snap.selectedUnitIndex ?? 0);
		classifiedReadings = new Map(snap.classifiedReadings ?? []);
		stemmaEdges = new Map(snap.stemmaEdges ?? []);
		alignmentDisplayMode = snap.alignmentDisplayMode ?? 'regularized';
		alignmentLayout = snap.alignmentLayout ?? 'grid';
		ignoreTokenWhitespace = true;
		segmentation = true;
		regularizedTexts = new Map();
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		stemmaNodes = new Map();
		commandHistory = [];
		commandIndex = -1;
	}

	function applyCollationDocumentPayload(rawDocument: unknown) {
		const document = parseCollationDocument(rawDocument);
		if (!document) throw new Error('Invalid collation document artifact.');
		const hydrated = hydrateCollationDocument(document);
		phase = normalizeLegacyPhase(hydrated.phase);
		furthestPhase = normalizeLegacyPhase(hydrated.furthestPhase);
		selectedVerse = hydrated.selectedVerse;
		selectedBook = hydrated.selectedBook;
		selectedChapter = hydrated.selectedChapter;
		selectedVerseNum = hydrated.selectedVerseNum;
		witnesses = hydrated.witnesses;
		rules = hydrated.rules.map(rule => ({
			...rule,
			type: coerceRegularizationType((rule as { type?: unknown }).type),
		}));
		lowercase = hydrated.lowercase;
		ignoreWordBreaks = hydrated.ignoreWordBreaks;
		ignoreTokenWhitespace = hydrated.ignoreTokenWhitespace;
		ignorePunctuation = hydrated.ignorePunctuation;
		suppliedTextMode = hydrated.suppliedTextMode;
		segmentation = hydrated.segmentation;
		transcriptionWitnessTreatments = new Map();
		alignmentColumns = deserializeAlignmentColumns(hydrated.alignmentColumns);
		witnessOrder = hydrated.witnessOrder;
		selectedUnitIndex = normalizeVariationUnitIndex(0);
		classifiedReadings = new Map(hydrated.classifiedReadings);
		stemmaEdges = new Map(hydrated.stemmaEdges);
		alignmentDisplayMode = hydrated.alignmentDisplayMode;
		alignmentLayout = hydrated.alignmentLayout;
		regularizedTexts = new Map();
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		stemmaNodes = new Map();
		commandHistory = [];
		commandIndex = -1;
	}

	function buildCollationDocumentPayload() {
		return buildCollationDocument({
			collationId,
			projectId,
			projectName,
			phase,
			furthestPhase,
			selectedVerse,
			selectedBook,
			selectedChapter,
			selectedVerseNum,
			witnesses,
			rules,
			ignoreWordBreaks,
			lowercase,
			ignoreTokenWhitespace,
			ignorePunctuation,
			suppliedTextMode,
			segmentation,
			alignmentColumns,
			witnessOrder,
			classifiedReadings,
			stemmaEdges,
			alignmentDisplayMode,
			alignmentLayout,
		});
	}

	function isFinalizedCollationPhase(): boolean {
		return phase === 'stemma';
	}

	async function syncNormalizedProjection(now: string): Promise<void> {
		if (!collationId) return;
		const persistedCollationId = collationId;

		const projection = buildCollationProjection({
			witnesses,
			alignmentColumns,
			getReadingsForUnit: unitIndex =>
				classifiedReadings.get(String(unitIndex)) ?? buildReadingsForUnit(unitIndex),
			getBaseTextForVariationUnit,
			getBaseWitnessId,
		});

		const existingWitnessRows = await CollationWitness.objects
			.filter(fields => fields.collation.eq(persistedCollationId))
			.all();
		const witnessRowByKey = new Map(
			existingWitnessRows.map(row => [row.witness_id, row] as const)
		);
		const activeWitnessKeys = new Set(projection.witnesses.map(row => row.witnessId));
		for (const row of projection.witnesses) {
			const existing = witnessRowByKey.get(row.witnessId);
			if (existing) {
				await CollationWitness.objects.update(existing._djazzkit_id, {
					_djazzkit_deleted: false,
					_djazzkit_updated_at: now,
					transcription_id: row.transcriptionId,
					source_version: row.sourceVersion,
					content: row.content,
					position: row.position,
				});
				continue;
			}
			await CollationWitness.objects.create({
				_djazzkit_id: crypto.randomUUID(),
				_djazzkit_rev: 0,
				_djazzkit_deleted: false,
				_djazzkit_updated_at: now,
				collation_id: persistedCollationId,
				witness_id: row.witnessId,
				transcription_id: row.transcriptionId,
				source_version: row.sourceVersion,
				content: row.content,
				position: row.position,
			});
		}
		for (const row of existingWitnessRows) {
			if (!activeWitnessKeys.has(row.witness_id) && !row._djazzkit_deleted) {
				await CollationWitness.objects.update(row._djazzkit_id, {
					_djazzkit_deleted: true,
					_djazzkit_updated_at: now,
				});
			}
		}

		const existingTokenRows = await CollationToken.objects
			.filter(fields => fields.collation.eq(persistedCollationId))
			.all();
		const tokenRowByKey = new Map<string, (typeof existingTokenRows)[number]>(
			existingTokenRows.map(row => [`${row.witness_id}::${row.token_index}`, row] as const)
		);
		const activeTokenKeys = new Set(
			projection.tokens.map(row => `${row.witnessId}::${row.tokenIndex}`)
		);
		for (const row of projection.tokens) {
			const key = `${row.witnessId}::${row.tokenIndex}`;
			const existing = tokenRowByKey.get(key);
			if (existing) {
				await CollationToken.objects.update(existing._djazzkit_id, {
					_djazzkit_deleted: false,
					_djazzkit_updated_at: now,
					token_text: row.tokenText.slice(0, 255),
				});
				continue;
			}
			await CollationToken.objects.create({
				_djazzkit_id: crypto.randomUUID(),
				_djazzkit_rev: 0,
				_djazzkit_deleted: false,
				_djazzkit_updated_at: now,
				collation_id: persistedCollationId,
				witness_id: row.witnessId,
				token_index: row.tokenIndex,
				token_text: row.tokenText.slice(0, 255),
			});
		}
		for (const row of existingTokenRows) {
			const key = `${row.witness_id}::${row.token_index}`;
			if (!activeTokenKeys.has(key) && !row._djazzkit_deleted) {
				await CollationToken.objects.update(row._djazzkit_id, {
					_djazzkit_deleted: true,
					_djazzkit_updated_at: now,
				});
			}
		}

		const existingVariationUnits = await CollationVariationUnit.objects
			.filter(fields => fields.collation.eq(persistedCollationId))
			.all();
		const variationUnitRowByKey = new Map<string, (typeof existingVariationUnits)[number]>();
		for (const row of existingVariationUnits) {
			const key = `${row.start_index}:${row.end_index}:${row.unit_type}`;
			if (!variationUnitRowByKey.has(key)) variationUnitRowByKey.set(key, row);
		}

		const allReadingRows = await CollationReading.objects.all().all();
		const collationVariationUnitIds = new Set(
			existingVariationUnits.map(row => row._djazzkit_id)
		);
		const existingReadingRows = allReadingRows.filter(row =>
			collationVariationUnitIds.has(row.variation_unit_id)
		);
		const allReadingWitnessRows = await CollationReadingWitness.objects.all().all();
		const existingReadingIds = new Set(existingReadingRows.map(row => row._djazzkit_id));
		const existingReadingWitnessRows = allReadingWitnessRows.filter(row =>
			existingReadingIds.has(row.reading_id)
		);

		const activeVariationUnitKeys = new Set(
			projection.variationUnits.map(
				row => `${row.startIndex}:${row.endIndex}:${row.unitType}`
			)
		);
		const chosenVariationUnitIds = new Set<string>();
		const chosenReadingIds = new Set<string>();
		const chosenReadingWitnessIds = new Set<string>();

		for (const unit of projection.variationUnits) {
			const unitKey = `${unit.startIndex}:${unit.endIndex}:${unit.unitType}`;
			let variationUnitId = variationUnitRowByKey.get(unitKey)?._djazzkit_id ?? null;
			if (variationUnitId) {
				chosenVariationUnitIds.add(variationUnitId);
				await CollationVariationUnit.objects.update(variationUnitId, {
					_djazzkit_deleted: false,
					_djazzkit_updated_at: now,
					start_index: unit.startIndex,
					end_index: unit.endIndex,
					unit_type: unit.unitType,
					base_text: unit.baseText,
				});
			} else {
				variationUnitId = crypto.randomUUID();
				chosenVariationUnitIds.add(variationUnitId);
				await CollationVariationUnit.objects.create({
					_djazzkit_id: variationUnitId,
					_djazzkit_rev: 0,
					_djazzkit_deleted: false,
					_djazzkit_updated_at: now,
					collation_id: persistedCollationId,
					start_index: unit.startIndex,
					end_index: unit.endIndex,
					unit_type: unit.unitType,
					base_text: unit.baseText,
				});
			}

			const existingUnitReadings = existingReadingRows.filter(
				row => row.variation_unit_id === variationUnitId
			);
			const readingRowByOrder = new Map(
				existingUnitReadings.map(row => [row.reading_order, row] as const)
			);
			const activeReadingOrders = new Set(unit.readings.map(row => row.readingOrder));

			for (const reading of unit.readings) {
				let readingId = readingRowByOrder.get(reading.readingOrder)?._djazzkit_id ?? null;
				if (readingId) {
					chosenReadingIds.add(readingId);
					await CollationReading.objects.update(readingId, {
						_djazzkit_deleted: false,
						_djazzkit_updated_at: now,
						reading_text: reading.readingText,
						is_omission: reading.isOmission,
						is_lacuna: reading.isLacuna,
					});
				} else {
					readingId = crypto.randomUUID();
					chosenReadingIds.add(readingId);
					await CollationReading.objects.create({
						_djazzkit_id: readingId,
						_djazzkit_rev: 0,
						_djazzkit_deleted: false,
						_djazzkit_updated_at: now,
						variation_unit_id: variationUnitId,
						reading_order: reading.readingOrder,
						reading_text: reading.readingText,
						is_omission: reading.isOmission,
						is_lacuna: reading.isLacuna,
					});
				}

				const existingWitnessAssignments = existingReadingWitnessRows.filter(
					row => row.reading_id === readingId
				);
				const witnessAssignmentByKey = new Map(
					existingWitnessAssignments.map(row => [row.witness_id, row] as const)
				);
				const activeWitnessIds = new Set(reading.witnessIds);
				for (const witnessId of reading.witnessIds) {
					const existing = witnessAssignmentByKey.get(witnessId);
					if (existing) {
						chosenReadingWitnessIds.add(existing._djazzkit_id);
						await CollationReadingWitness.objects.update(existing._djazzkit_id, {
							_djazzkit_deleted: false,
							_djazzkit_updated_at: now,
						});
						continue;
					}
					const assignmentId = crypto.randomUUID();
					chosenReadingWitnessIds.add(assignmentId);
					await CollationReadingWitness.objects.create({
						_djazzkit_id: assignmentId,
						_djazzkit_rev: 0,
						_djazzkit_deleted: false,
						_djazzkit_updated_at: now,
						reading_id: readingId,
						witness_id: witnessId,
					});
				}
				for (const row of existingWitnessAssignments) {
					if (!activeWitnessIds.has(row.witness_id) && !row._djazzkit_deleted) {
						await CollationReadingWitness.objects.update(row._djazzkit_id, {
							_djazzkit_deleted: true,
							_djazzkit_updated_at: now,
						});
					}
				}
			}

			for (const row of existingUnitReadings) {
				if (!activeReadingOrders.has(row.reading_order) && !row._djazzkit_deleted) {
					await CollationReading.objects.update(row._djazzkit_id, {
						_djazzkit_deleted: true,
						_djazzkit_updated_at: now,
					});
				}
			}
		}

		for (const row of existingReadingWitnessRows) {
			if (!chosenReadingWitnessIds.has(row._djazzkit_id) && !row._djazzkit_deleted) {
				await CollationReadingWitness.objects.update(row._djazzkit_id, {
					_djazzkit_deleted: true,
					_djazzkit_updated_at: now,
				});
			}
		}
		for (const row of existingReadingRows) {
			if (!chosenReadingIds.has(row._djazzkit_id) && !row._djazzkit_deleted) {
				await CollationReading.objects.update(row._djazzkit_id, {
					_djazzkit_deleted: true,
					_djazzkit_updated_at: now,
				});
			}
		}
		for (const row of existingVariationUnits) {
			const key = `${row.start_index}:${row.end_index}:${row.unit_type}`;
			if (
				(!activeVariationUnitKeys.has(key) ||
					!chosenVariationUnitIds.has(row._djazzkit_id)) &&
				!row._djazzkit_deleted
			) {
				await CollationVariationUnit.objects.update(row._djazzkit_id, {
					_djazzkit_deleted: true,
					_djazzkit_updated_at: now,
				});
			}
		}
	}

	async function materializeFinalCollationProjection(now: string): Promise<void> {
		if (!isFinalizedCollationPhase()) return;
		await syncNormalizedProjection(now);
	}

	async function persistDocument(): Promise<void> {
		if (!collationId) return;
		try {
			await ensureDjazzkitRuntime();
			const now = new Date().toISOString();
			const payload = serializeCollationDocument(buildCollationDocumentPayload());

			const currentArtifactId = workspaceArtifactId;
			if (currentArtifactId) {
				// Update existing artifact
				const existing = await CollationArtifact.objects
					.filter(f => f._djazzkit_id.eq(currentArtifactId))
					.filter(f => f._djazzkit_deleted.eq(false))
					.first();
				if (existing) {
					await CollationArtifact.objects.update(currentArtifactId, {
						payload,
						_djazzkit_updated_at: now,
					});
				} else {
					// Artifact was deleted, re-create
					workspaceArtifactId = crypto.randomUUID();
					await CollationArtifact.objects.create({
						_djazzkit_id: workspaceArtifactId,
						_djazzkit_rev: 0,
						_djazzkit_deleted: false,
						_djazzkit_updated_at: now,
						collation_id: collationId,
						artifact_type: COLLATION_DOCUMENT_ARTIFACT_TYPE,
						payload,
						created_at: now,
					});
				}
			} else {
				// Create new artifact
				workspaceArtifactId = crypto.randomUUID();
				await CollationArtifact.objects.create({
					_djazzkit_id: workspaceArtifactId,
					_djazzkit_rev: 0,
					_djazzkit_deleted: false,
					_djazzkit_updated_at: now,
					collation_id: collationId,
					artifact_type: COLLATION_DOCUMENT_ARTIFACT_TYPE,
					payload,
					created_at: now,
				});
			}
			await materializeFinalCollationProjection(now);
			// Also update the collation's updated_at
			await Collation.objects.update(collationId, {
				updated_at: now,
				_djazzkit_updated_at: now,
				status: isFinalizedCollationPhase() ? 'complete' : phase,
			});
		} catch (err) {
			console.error('Failed to persist collation document:', err);
			saveStatus = 'error';
		}
	}

	function markUnsaved() {
		saveStatus = 'unsaved';
		scheduleSave();
	}

	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	function scheduleSave() {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			saveStatus = 'saving';
			await persistDocument();
			if (saveStatus === 'saving') {
				saveStatus = 'saved';
			}
		}, 800);
	}

	function pushCommand(cmd: CommandEntry) {
		commandHistory = commandHistory.slice(0, commandIndex + 1);
		commandHistory.push(cmd);
		commandIndex = commandHistory.length - 1;
		markUnsaved();
	}

	function undo() {
		if (commandIndex < 0) return;
		commandHistory[commandIndex].undo();
		commandIndex--;
		markUnsaved();
	}

	function redo() {
		if (commandIndex >= commandHistory.length - 1) return;
		commandIndex++;
		commandHistory[commandIndex].redo();
		markUnsaved();
	}

	function setPhase(p: CollationPhase) {
		const normalized = normalizeLegacyPhase(p);
		phase = normalized;
		advanceFurthest(normalized);
	}

	function advanceFurthest(p: CollationPhase) {
		if (PHASE_ORDER.indexOf(p) > PHASE_ORDER.indexOf(furthestPhase)) {
			furthestPhase = p;
		}
	}

	function canNavigateTo(targetPhase: CollationPhase): boolean {
		return PHASE_ORDER.indexOf(targetPhase) <= PHASE_ORDER.indexOf(furthestPhase);
	}

	function canAdvance(): boolean {
		if (phase === 'setup') return selectedVerse !== null && witnesses.some(w => !w.isExcluded);
		if (phase === 'regularization') return witnesses.some(w => !w.isExcluded);
		if (phase === 'alignment') return alignmentColumns.length > 0;
		if (phase === 'readings') return alignmentColumns.length > 0;
		return false;
	}

	function nextPhase() {
		const idx = PHASE_ORDER.indexOf(phase);
		if (idx < PHASE_ORDER.length - 1 && canAdvance()) {
			const next = PHASE_ORDER[idx + 1];
			phase = next;
			advanceFurthest(next);
			markUnsaved();
		}
	}

	function prevPhase() {
		const idx = PHASE_ORDER.indexOf(phase);
		if (idx > 0) {
			phase = PHASE_ORDER[idx - 1];
		}
	}

	function resetSetupSelections() {
		selectedVerse = null;
		witnesses = [];
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
		regularizedTexts = new Map();
	}

	function cloneWitnessSourceTokens(tokens: WitnessSourceToken[] | undefined): WitnessSourceToken[] {
		return (tokens ?? []).map(token => ({
			...token,
			segments: token.segments.map(segment => ({ ...segment })),
			gap: token.gap ? { ...token.gap } : null,
		}));
	}

	function normalizeConcreteWitnessTreatment(treatment: WitnessTreatment): 'full' | 'fragmentary' {
		return treatment === 'full' ? 'full' : 'fragmentary';
	}

	function buildWitnessSourceKey(source: {
		transcriptionId: string;
		handId?: string;
		kind?: WitnessConfig['kind'];
	}): string {
		return `${source.transcriptionId}::${source.kind ?? 'firsthand'}::${source.handId ?? 'firsthand'}`;
	}

	function getExcludedHandsForTranscription(transcriptionId: string): string[] {
		return transcriptionWitnessExcludedHands.get(transcriptionId) ?? [];
	}

	function isWitnessIncludedByProjectSettings(source: {
		transcriptionId: string;
		handId?: string;
	}): boolean {
		const handId = source.handId ?? 'firsthand';
		return !getExcludedHandsForTranscription(source.transcriptionId).includes(handId);
	}

	function filterWitnessesByProjectSettings(configs: WitnessConfig[]): WitnessConfig[] {
		return configs.filter((config) => isWitnessIncludedByProjectSettings(config));
	}

	function ensureBaseTextSelection(configs: WitnessConfig[]): WitnessConfig[] {
		if (configs.length === 0) return configs;
		if (configs.some((witness) => witness.isBaseText)) return configs;
		return configs.map((witness, index) => ({
			...witness,
			isBaseText: index === 0,
		}));
	}

	function applyWitnessTreatmentSource(witness: WitnessConfig): WitnessConfig {
		const kind = witness.kind ?? 'firsthand';
		if (kind !== 'corrector') {
			const fullTokens = cloneWitnessSourceTokens(witness.fullTokens ?? witness.tokens);
			const fullContent = witness.fullContent ?? witness.content;
			return {
				...witness,
				kind,
				content: fullContent,
				tokens: fullTokens,
				fullContent,
				fullTokens,
				treatment: witness.treatment === 'inherit' ? 'full' : witness.treatment,
			};
		}
		const activeTreatment =
			witness.treatment === 'inherit'
				? normalizeConcreteWitnessTreatment(getProjectTranscriptionTreatment(witness.transcriptionId))
				: normalizeConcreteWitnessTreatment(witness.treatment);
		const nextTokens =
			activeTreatment === 'full'
				? cloneWitnessSourceTokens(witness.fullTokens ?? witness.tokens)
				: cloneWitnessSourceTokens(witness.fragmentaryTokens ?? witness.tokens);
		const nextContent =
			activeTreatment === 'full'
				? witness.fullContent ?? witness.content
				: witness.fragmentaryContent ?? witness.content;
		return {
			...witness,
			kind,
			content: nextContent,
			tokens: nextTokens,
		};
	}

	function applyWitnessTreatmentSources(configs: WitnessConfig[]): WitnessConfig[] {
		return configs.map(applyWitnessTreatmentSource);
	}

	function buildWitnessConfigFromPrepared(
		prepared: PreparedWitness,
		options?: { isBaseText?: boolean }
	): WitnessConfig {
		return applyWitnessTreatmentSource({
			witnessId: prepared.id,
			siglum: prepared.siglum,
			transcriptionId: prepared.transcriptionUid,
			kind: prepared.kind,
			handId: prepared.handId,
			sourceVersion: prepared.sourceVersion,
			content: prepared.content,
			tokens: cloneWitnessSourceTokens(prepared.tokens),
			fullContent: prepared.fullContent,
			fullTokens: cloneWitnessSourceTokens(prepared.fullTokens ?? prepared.tokens),
			fragmentaryContent: prepared.fragmentaryContent,
			fragmentaryTokens: cloneWitnessSourceTokens(prepared.fragmentaryTokens ?? prepared.tokens),
			treatment: prepared.kind === 'corrector' ? 'inherit' : 'full',
			isBaseText: options?.isBaseText === true,
			isExcluded: false,
			overridesDefault: false,
		});
	}

	async function hydrateProjectContext(nextProjectId: string | null): Promise<void> {
		projectId = nextProjectId;
		projectName = null;
		rules = rules.filter(rule => rule.scope !== 'project');
		const previousIgnoreWordBreaks = ignoreWordBreaks;
		ignoreWordBreaks = false;
		lowercase = false;
		ignoreTokenWhitespace = true;
		ignorePunctuation = false;
		suppliedTextMode = 'clear';
		segmentation = true;
		transcriptionWitnessTreatments = new Map();
		transcriptionWitnessExcludedHands = new Map();
		if (!nextProjectId) {
			applyRegularization();
			return;
		}

		await ensureDjazzkitRuntime();
		const project = await Project.objects
			.filter(fields => fields._djazzkit_id.eq(nextProjectId))
			.filter(fields => fields._djazzkit_deleted.eq(false))
			.first();
		if (!project) {
			projectId = null;
			applyRegularization();
			return;
		}

		projectName = project.name;
		const settings = parseProjectCollationSettings(project.collation_settings);
		ignoreWordBreaks = settings.ignoreWordBreaks ?? false;
		lowercase = settings.lowercase ?? false;
		ignoreTokenWhitespace = settings.ignoreTokenWhitespace ?? true;
		ignorePunctuation = settings.ignorePunctuation ?? false;
		suppliedTextMode = settings.suppliedTextMode ?? 'clear';
		segmentation = settings.segmentation ?? true;
		transcriptionWitnessTreatments = new Map(
			Object.entries(settings.transcriptionWitnessTreatments ?? {})
		);
		transcriptionWitnessExcludedHands = new Map(
			Object.entries(settings.transcriptionWitnessExcludedHands ?? {}).map(([id, handIds]) => [
				id,
				[...handIds],
			]),
		);
		rules = mergeProjectRules(rules, settings.regularizationRules ?? []);
		if (
			previousIgnoreWordBreaks !== ignoreWordBreaks &&
			selectedVerse?.identifier &&
			witnesses.length > 0
		) {
			const didChange = await refreshWitnessesFromTranscriptionSource();
			if (didChange) {
				handleWitnessSourceChange();
				saveStatus = 'unsaved';
				scheduleSave();
			}
		}
		applyRegularization();
	}

	async function selectProject(nextProjectId: string): Promise<void> {
		resetSetupSelections();
		await hydrateProjectContext(nextProjectId);
		markUnsaved();
	}

	async function clearProjectSelection(): Promise<void> {
		resetSetupSelections();
		await hydrateProjectContext(null);
		markUnsaved();
	}

	async function createProject(name: string): Promise<string> {
		await ensureDjazzkitRuntime();
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		await Project.objects.create({
			_djazzkit_id: id,
			_djazzkit_rev: 0,
			_djazzkit_deleted: false,
			_djazzkit_updated_at: now,
			name,
			description: '',
			charter: '',
			collation_settings: JSON.stringify(
				createProjectCollationSettings([], {
					ignoreWordBreaks: false,
					lowercase: false,
					ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments,
				transcriptionWitnessExcludedHands,
				})
			),
			owner_id: null,
			created_at: now,
			updated_at: now,
		});
		await selectProject(id);
		return id;
	}

	// Witness configuration
	function setWitnesses(configs: WitnessConfig[]) {
		witnesses = ensureBaseTextSelection(
			applyWitnessTreatmentSources(filterWitnessesByProjectSettings(configs)),
		);
		applyRegularization();
		markUnsaved();
	}

	function updateWitness(witnessId: string, updates: Partial<WitnessConfig>) {
		witnesses = applyWitnessTreatmentSources(
			witnesses.map((w) => {
				if (w.witnessId !== witnessId) return w;
				const next = { ...w, ...updates };
				if (Object.prototype.hasOwnProperty.call(updates, 'treatment')) {
					next.overridesDefault = next.treatment !== 'inherit';
				}
				return next;
			}),
		);
		applyRegularization();
		markUnsaved();
	}

	function toggleWitnessExclusion(witnessId: string) {
		const w = witnesses.find(w => w.witnessId === witnessId);
		if (!w) return;
		const prev = w.isExcluded;
		updateWitness(witnessId, { isExcluded: !prev });
		pushCommand({
			type: 'toggle-witness',
			description: `${prev ? 'Include' : 'Exclude'} witness ${w.siglum}`,
			undo: () => updateWitness(witnessId, { isExcluded: prev }),
			redo: () => updateWitness(witnessId, { isExcluded: !prev }),
		});
	}

	function setBaseText(witnessId: string) {
		const prev = witnesses.find(w => w.isBaseText)?.witnessId;
		witnesses = witnesses.map(w => ({ ...w, isBaseText: w.witnessId === witnessId }));
		if (prev !== witnessId) {
			const ordered = getOrderedActiveWitnessIds();
			if (ordered.length > 0) {
				witnessOrder = ordered;
			}
		}
		markUnsaved();
	}

	// Regularization
	async function persistRulesToProject(nextRules: RegularizationRule[]): Promise<void> {
		if (!projectId) return;
		try {
			await ensureDjazzkitRuntime();
			await Project.objects.update(projectId, {
				collation_settings: JSON.stringify(
					createProjectCollationSettings(nextRules, {
						ignoreWordBreaks,
						lowercase,
						ignoreTokenWhitespace,
				ignorePunctuation,
				suppliedTextMode,
				segmentation,
				transcriptionWitnessTreatments,
				transcriptionWitnessExcludedHands,
				})
			),
				_djazzkit_updated_at: new Date().toISOString(),
			});
		} catch (err) {
			console.error('Failed to persist project collation settings:', err);
		}
	}

	function setRules(nextRules: RegularizationRule[]) {
		rules = nextRules;
		void persistRulesToProject(nextRules);
		markUnsaved();
	}

	function addRule(rule: RegularizationRule) {
		setRules([...rules, rule]);
	}

	function removeRule(ruleId: string) {
		setRules(rules.filter(r => r.id !== ruleId));
	}

	function toggleRule(ruleId: string) {
		setRules(rules.map(r => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)));
	}

	function setRuleType(ruleId: string, type: RegularizationType) {
		setRules(rules.map(r => (r.id === ruleId ? { ...r, type } : r)));
	}

	function setLowercase(nextValue: boolean) {
		lowercase = nextValue;
		void persistRulesToProject(rules);
		applyRegularization();
		markUnsaved();
	}

	async function setIgnoreWordBreaks(nextValue: boolean) {
		if (ignoreWordBreaks === nextValue) return;
		ignoreWordBreaks = nextValue;
		await persistRulesToProject(rules);
		const didChange = await refreshWitnessesFromTranscriptionSource();
		if (didChange) {
			handleWitnessSourceChange();
		}
		applyRegularization();
		markUnsaved();
	}

	function setIgnorePunctuation(nextValue: boolean) {
		ignorePunctuation = nextValue;
		void persistRulesToProject(rules);
		applyRegularization();
		markUnsaved();
	}

	function setSuppliedTextMode(nextValue: SuppliedTextMode) {
		suppliedTextMode = nextValue;
		void persistRulesToProject(rules);
		applyRegularization();
		markUnsaved();
	}

	function setSegmentation(nextValue: boolean) {
		segmentation = nextValue;
		void persistRulesToProject(rules);
		markUnsaved();
	}

	function setProjectTranscriptionTreatment(
		transcriptionId: string,
		treatment: WitnessTreatment
	) {
		const normalizedTreatment = treatment === 'full' ? 'full' : 'fragmentary';
		const nextMap = new Map(transcriptionWitnessTreatments);
		nextMap.set(transcriptionId, normalizedTreatment);
		transcriptionWitnessTreatments = nextMap;
		witnesses = applyWitnessTreatmentSources(witnesses);
		applyRegularization();
		void persistRulesToProject(rules);
		markUnsaved();
	}

	function setAllProjectTranscriptionTreatments(
		transcriptionIds: string[],
		treatment: WitnessTreatment
	) {
		const normalizedTreatment = treatment === 'full' ? 'full' : 'fragmentary';
		const nextMap = new Map(transcriptionWitnessTreatments);
		for (const transcriptionId of transcriptionIds) {
			nextMap.set(transcriptionId, normalizedTreatment);
		}
		transcriptionWitnessTreatments = nextMap;
		witnesses = applyWitnessTreatmentSources(witnesses);
		applyRegularization();
		void persistRulesToProject(rules);
		markUnsaved();
	}

	function isProjectTranscriptionHandIncluded(transcriptionId: string, handId: string): boolean {
		return isWitnessIncludedByProjectSettings({ transcriptionId, handId });
	}

	function setProjectTranscriptionHandIncluded(
		transcriptionId: string,
		handId: string,
		included: boolean,
	) {
		const normalizedHandId = handId.trim();
		if (!normalizedHandId) return;
		const nextMap = new Map(transcriptionWitnessExcludedHands);
		const currentExcluded = new Set(getExcludedHandsForTranscription(transcriptionId));
		if (included) {
			currentExcluded.delete(normalizedHandId);
		} else {
			currentExcluded.add(normalizedHandId);
		}
		if (currentExcluded.size === 0) {
			nextMap.delete(transcriptionId);
		} else {
			nextMap.set(transcriptionId, [...currentExcluded].sort());
		}
		transcriptionWitnessExcludedHands = nextMap;
		void persistRulesToProject(rules);
		if (selectedVerse?.identifier) {
			void refreshWitnessesFromSource([transcriptionId]);
		}
		markUnsaved();
	}

	function getProjectTranscriptionTreatment(transcriptionId: string): WitnessTreatment {
		return transcriptionWitnessTreatments.get(transcriptionId) ?? 'fragmentary';
	}

	function setAlignmentDisplayMode(mode: AlignmentDisplayMode) {
		alignmentDisplayMode = mode;
		markUnsaved();
	}

	function setAlignmentLayout(layout: AlignmentLayout) {
		alignmentLayout = layout;
		markUnsaved();
	}

	function regularizeTextValue(
		input: string,
		activeRules = rules.filter(rule => rule.enabled)
	): {
		regularizedText: string;
		ruleIds: string[];
		types: RegularizationType[];
	} {
		let result = input;
		const ruleIds: string[] = [];
		const typeSet = new Set<RegularizationType>();

		for (const rule of activeRules) {
			try {
				const regex = new RegExp(rule.pattern, 'g');
				const replaced = result.replace(regex, rule.replacement);
				if (replaced !== result) {
					result = replaced;
					ruleIds.push(rule.id);
					if (rule.type !== 'none') typeSet.add(rule.type);
				}
			} catch {
				// Skip invalid regex rules.
			}
		}

		return {
			regularizedText: result,
			ruleIds,
			types: [...typeSet],
		};
	}

	function buildGapPlaceholder(
		gap: GapMetadata | null,
		fallbackSource: GapMetadata['source']
	): string {
		const meta = gap ?? { source: fallbackSource, reason: '', unit: '', extent: '' };
		return [
			`__${meta.source}__`,
			meta.reason || 'none',
			meta.unit || 'none',
			meta.extent || 'none',
		].join(':');
	}

	function deriveRegularizedToken(
		sourceToken: WitnessSourceToken,
		activeRules = rules.filter(rule => rule.enabled)
	): RegularizedToken | null {
		if (sourceToken.kind === 'gap' || sourceToken.kind === 'untranscribed') {
			return {
				original: sourceToken.original,
				originalSegments: sourceToken.segments.map(segment => ({ ...segment })),
				regularized: null,
				alignmentValue: buildGapPlaceholder(
					sourceToken.gap,
					sourceToken.gap?.source ?? sourceToken.kind
				),
				ruleIds: [],
				types: [],
				kind: sourceToken.kind,
				gap: sourceToken.gap,
				hasUnclear: false,
				isPunctuation: false,
				isSupplied: false,
			};
		}

		const original = sourceToken.original;
		const originalSegments = sourceToken.segments.map(segment => ({ ...segment }));
		const hasUnclear = sourceToken.segments.some(segment => segment.hasUnclear);
		const isPunctuationOnly =
			sourceToken.segments.length > 0 &&
			sourceToken.segments.every(segment => segment.isPunctuation);
		const isSupplied = sourceToken.segments.some(segment => segment.isSupplied);

		let structuralText = sourceToken.segments
			.map(segment => {
				if (segment.hasUnclear) return segment.text;
				if (ignorePunctuation && segment.isPunctuation) return '';
				if (suppliedTextMode === 'gap' && segment.isSupplied) return '';
				return segment.text;
			})
			.join('')
			.replace(/\s+/g, ' ')
			.trim();

		if (lowercase) {
			structuralText = structuralText.toLocaleLowerCase();
		}

		if (ignoreTokenWhitespace) {
			structuralText = structuralText.replace(/\\[ncp]/g, '');
			structuralText = structuralText.replace(/\s+/g, '');
		}

		const suppliedOnly =
			sourceToken.segments.length > 0 &&
			sourceToken.segments.every(segment => segment.isSupplied);

		if (suppliedTextMode === 'gap' && suppliedOnly) {
			return {
				original,
				originalSegments,
				regularized: null,
				alignmentValue: buildGapPlaceholder(
					{
						source: 'supplied',
						reason: 'supplied',
						unit: '',
						extent: '',
					},
					'supplied'
				),
				ruleIds: [],
				types: [],
				kind: 'gap',
				gap: {
					source: 'supplied',
					reason: 'supplied',
					unit: '',
					extent: '',
				},
				hasUnclear,
				isPunctuation: isPunctuationOnly,
				isSupplied: true,
			};
		}

		if (structuralText.length === 0) {
			return null;
		}

		const regularizedValue = regularizeTextValue(structuralText, activeRules);
		return {
			original,
			originalSegments,
			regularized: regularizedValue.regularizedText,
			alignmentValue: regularizedValue.regularizedText,
			ruleIds: regularizedValue.ruleIds,
			types: regularizedValue.types,
			kind: 'text',
			gap: null,
			hasUnclear,
			isPunctuation: isPunctuationOnly,
			isSupplied,
		};
	}

	function applyRegularization() {
		const activeRules = rules.filter(r => r.enabled);
		const newTexts = new Map<string, RegularizedToken[]>();

		for (const w of witnesses.filter(w => !w.isExcluded)) {
			const regularized = w.tokens
				.map(token => deriveRegularizedToken(token, activeRules))
				.filter((token): token is RegularizedToken => token !== null);
			newTexts.set(w.witnessId, regularized);
		}
		regularizedTexts = newTexts;
	}

	function buildWitnessInputFromAlignment(witnessId: string): CollationWitnessInput {
		const tokens = alignmentColumns
			.map(col => col.cells.get(witnessId))
			.filter((cell): cell is AlignmentCell => Boolean(cell) && !cell!.isOmission)
			.map(cell => {
				return {
					t: cell.text ?? '',
					n: cell.alignmentValue ?? '',
					sourceTokenIds: cell.sourceTokenIds,
					kind: cell.kind === 'omission' ? 'text' : cell.kind,
					displayRegularized: cell.regularizedText,
					originalSegments: cell.originalSegments?.map(segment => ({ ...segment })),
					gap: cell.gap,
					ruleIds: cell.ruleIds,
					regularizationTypes: cell.regularizationTypes,
				};
			});
		const preparedTokens = mergeIgnoredPunctuationIntoPreviousToken(tokens);

		return {
			id: witnessId,
			content: joinTokenTexts(preparedTokens.map(token => tokenToJoinablePart(token))),
			tokens: preparedTokens,
		};
	}

	function buildWitnessInputFromWitness(witnessId: string): CollationWitnessInput {
		const witness = witnesses.find(item => item.witnessId === witnessId);
		const activeRules = rules.filter(rule => rule.enabled);
		const preparedTokens: CollationTokenInput[] = [];
		for (const [index, sourceToken] of (witness?.tokens ?? []).entries()) {
			const token = deriveRegularizedToken(sourceToken, activeRules);
			if (!token) {
				if (
					ignorePunctuation &&
					sourceToken.kind === 'text' &&
					sourceToken.segments.length > 0 &&
					sourceToken.segments.every(segment => segment.isPunctuation)
				) {
					preparedTokens.push({
						t: sourceToken.original,
						n: '',
						sourceTokenIds: [`${witnessId}::source::${index}`],
						kind: 'text',
						displayRegularized: null,
						originalSegments: sourceToken.segments.map(segment => ({ ...segment })),
						gap: null,
						hasUnclear: sourceToken.segments.some(segment => segment.hasUnclear),
						isPunctuation: true,
						isSupplied: sourceToken.segments.some(segment => segment.isSupplied),
						ruleIds: [],
						regularizationTypes: [],
					});
				}
				continue;
			}
			preparedTokens.push({
				t: token.original,
				n: token.alignmentValue ?? '',
				sourceTokenIds: [`${witnessId}::source::${index}`],
				kind: token.kind === 'omission' ? 'text' : token.kind,
				displayRegularized: token.regularized,
				originalSegments: token.originalSegments.map(segment => ({ ...segment })),
				gap: token.gap,
				hasUnclear: token.hasUnclear,
				isPunctuation: token.isPunctuation,
				isSupplied: token.isSupplied,
				ruleIds: token.ruleIds,
				regularizationTypes: token.types,
			});
		}
		const mergedTokens = mergeIgnoredPunctuationIntoPreviousToken(preparedTokens);
		return {
			id: witnessId,
			content: joinTokenTexts(mergedTokens.map(token => tokenToJoinablePart(token))),
			tokens: mergedTokens,
		};
	}

	function hasCollapsedAlignmentRegression(): boolean {
		if (alignmentColumns.length !== 1) return false;
		const activeWitnesses = witnesses.filter(witness => !witness.isExcluded);
		if (activeWitnesses.length < 2) return false;
		if (!activeWitnesses.some(witness => witness.tokens.length > 1)) return false;
		const column = alignmentColumns[0];
		return activeWitnesses.every(witness => {
			const cell = column.cells.get(witness.witnessId);
			if (!cell || cell.isOmission || !cell.text) return false;
			return (
				cell.text.replace(/\s+/g, ' ').trim() ===
				witness.content.replace(/\s+/g, ' ').trim()
			);
		});
	}

	function rebuildAlignmentFromWitnessTokens() {
		const snapshot = collateToAlignmentSnapshot({
			witnesses: getOrderedActiveWitnessIds().map(buildWitnessInputFromWitness),
			options: { segmentation },
		});
		applyAlignmentSnapshot(snapshot.snapshot);
	}

	function didPreparedWitnessChangeSource(
		witness: WitnessConfig,
		prepared: PreparedWitness
	): boolean {
		if ((witness.kind ?? 'firsthand') !== prepared.kind) return true;
		if ((witness.handId ?? 'firsthand') !== prepared.handId) return true;
		if (witness.siglum !== prepared.siglum) return true;
		if ((witness.sourceVersion ?? '') !== prepared.sourceVersion) return true;
		if ((witness.fullContent ?? witness.content) !== (prepared.fullContent ?? prepared.content)) return true;
		if ((witness.fragmentaryContent ?? '') !== (prepared.fragmentaryContent ?? '')) return true;
		if (
			JSON.stringify(witness.fullTokens ?? witness.tokens) !==
				JSON.stringify(prepared.fullTokens ?? prepared.tokens)
		) {
			return true;
		}
		return (
			JSON.stringify(witness.fragmentaryTokens ?? []) !==
			JSON.stringify(prepared.fragmentaryTokens ?? [])
		);
	}

	async function findChangedWitnessTranscriptionIds(): Promise<string[]> {
		const transcriptionIds = [
			...new Set(
				witnesses
					.map(witness => witness.transcriptionId)
					.filter((id): id is string => typeof id === 'string' && id.length > 0)
			),
		];
		if (transcriptionIds.length === 0) return [];

		const currentRows = await Transcription.objects
			.filter(fields => fields._djazzkit_id.inList(transcriptionIds))
			.filter(fields => fields._djazzkit_deleted.eq(false))
			.all();
		const currentVersionById = new Map(
			currentRows.map(
				row => [row._djazzkit_id, row.updated_at || row._djazzkit_updated_at || ''] as const
			)
		);
		const changed = new Set<string>();
		for (const witness of witnesses) {
			if (!witness.transcriptionId) continue;
			const currentVersion = currentVersionById.get(witness.transcriptionId);
			if (!currentVersion) continue;
			if ((witness.sourceVersion ?? '') !== currentVersion) {
				changed.add(witness.transcriptionId);
			}
		}
		return [...changed];
	}

	async function refreshWitnessesFromTranscriptionSource(
		transcriptionIds?: string[],
		options?: { expectedCollationId?: string }
	): Promise<boolean> {
		if (!selectedVerse?.identifier) return false;
		const scopedTranscriptionIds =
			transcriptionIds ??
			witnesses
				.map(witness => witness.transcriptionId)
				.filter((id): id is string => typeof id === 'string' && id.length > 0);
		if (scopedTranscriptionIds.length === 0) return false;

		const preparedWitnesses = await gatherWitnessesForVerse(
			selectedVerse.identifier,
			scopedTranscriptionIds,
			{ ignoreWordBreaks }
		);
		if (options?.expectedCollationId && collationId !== options.expectedCollationId)
			return false;
		const scopedIds = new Set(scopedTranscriptionIds);
		const preparedByKey = new Map(
			preparedWitnesses.map(witness => [
				buildWitnessSourceKey({
					transcriptionId: witness.transcriptionUid,
					kind: witness.kind,
					handId: witness.handId,
				}),
				witness,
			] as const)
		);
		let didChange = false;
		const nextWitnesses: WitnessConfig[] = [];
		const seenPreparedKeys = new Set<string>();
		for (const witness of witnesses) {
			if (!scopedIds.has(witness.transcriptionId)) {
				nextWitnesses.push(witness);
				continue;
			}
			if (!isWitnessIncludedByProjectSettings(witness)) {
				didChange = true;
				continue;
			}
			const sourceKey = buildWitnessSourceKey(witness);
			const prepared = preparedByKey.get(sourceKey);
			if (!prepared) {
				didChange = true;
				continue;
			}
			seenPreparedKeys.add(sourceKey);
			if (didPreparedWitnessChangeSource(witness, prepared)) {
				didChange = true;
			}
			nextWitnesses.push(
				applyWitnessTreatmentSource({
					...witness,
					siglum: prepared.siglum,
					kind: prepared.kind,
					handId: prepared.handId,
					sourceVersion: prepared.sourceVersion,
					fullContent: prepared.fullContent ?? prepared.content,
					fullTokens: cloneWitnessSourceTokens(prepared.fullTokens ?? prepared.tokens),
					fragmentaryContent: prepared.fragmentaryContent,
					fragmentaryTokens: cloneWitnessSourceTokens(prepared.fragmentaryTokens ?? []),
					content: prepared.content,
					tokens: cloneWitnessSourceTokens(prepared.tokens),
				}),
			);
		}
		for (const prepared of preparedWitnesses) {
			if (
				!isWitnessIncludedByProjectSettings({
					transcriptionId: prepared.transcriptionUid,
					handId: prepared.handId,
				})
			) {
				continue;
			}
			const sourceKey = buildWitnessSourceKey({
				transcriptionId: prepared.transcriptionUid,
				kind: prepared.kind,
				handId: prepared.handId,
			});
			if (seenPreparedKeys.has(sourceKey)) continue;
			didChange = true;
			nextWitnesses.push(buildWitnessConfigFromPrepared(prepared));
		}
		witnesses = ensureBaseTextSelection(applyWitnessTreatmentSources(nextWitnesses));
		return didChange;
	}

	async function refreshChangedWitnessSourcesAfterLoad(
		expectedCollationId: string
	): Promise<void> {
		const changedTranscriptionIds = await findChangedWitnessTranscriptionIds();
		if (changedTranscriptionIds.length === 0) return;
		if (collationId !== expectedCollationId) return;
		const didChange = await refreshWitnessesFromTranscriptionSource(changedTranscriptionIds, {
			expectedCollationId,
		});
		if (!didChange || collationId !== expectedCollationId) return;
		applyRegularization();
		const repairedCollapsedAlignment = hasCollapsedAlignmentRegression();
		if (repairedCollapsedAlignment) {
			rebuildAlignmentFromWitnessTokens();
		}
		saveStatus = 'unsaved';
		scheduleSave();
	}

	async function refreshWitnessesFromSource(transcriptionIds?: string[]): Promise<boolean> {
		const didChange = await refreshWitnessesFromTranscriptionSource(transcriptionIds);
		if (!didChange) return false;
		handleWitnessSourceChange();
		saveStatus = 'unsaved';
		scheduleSave();
		return true;
	}

	function handleWitnessSourceChange() {
		applyRegularization();
		if (alignmentColumns.length > 0) {
			rebuildAlignmentFromWitnessTokens();
		}
		classifiedReadings = new Map();
		stemmaEdges = new Map();
		stemmaNodes = new Map();
		selectedUnitIndex = 0;
		if (furthestPhase === 'stemma') {
			furthestPhase = 'alignment';
		}
		if (phase === 'stemma') {
			phase = 'alignment';
		}
	}

	function buildCollationWitnessInputs(options?: {
		forceSourceWitnesses?: boolean;
	}): CollationWitnessInput[] {
		const orderedIds = getOrderedActiveWitnessIds();
		if (
			!options?.forceSourceWitnesses &&
			alignmentColumns.length > 0 &&
			!hasCollapsedAlignmentRegression()
		) {
			return orderedIds.map(buildWitnessInputFromAlignment);
		}
		return orderedIds.map(buildWitnessInputFromWitness);
	}

	// Alignment
	function applyAlignmentSnapshot(snapshot: AlignmentSnapshot) {
		witnessOrder = [...snapshot.witnessOrder];
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		alignmentColumns = deserializeAlignmentColumns(snapshot.columns);
	}

	function setAlignmentSnapshot(snapshot: AlignmentSnapshot) {
		applyAlignmentSnapshot(snapshot);
		selectedUnitIndex = normalizeVariationUnitIndex(selectedUnitIndex);
		advanceFurthest('alignment');
		classifiedReadings = new Map();
		stemmaEdges = new Map();
		markUnsaved();
	}

	function makeAlignmentCell(
		text: string | null,
		options?: {
			kind?: AlignmentCellKind;
			gap?: GapMetadata | null;
			alignmentValue?: string | null;
			regularizedText?: string | null;
			isLacuna?: boolean;
			sourceTokenIds?: string[];
			ruleIds?: string[];
			regularizationTypes?: RegularizationType[];
		}
	): AlignmentCell {
		const kind = options?.kind ?? (text === null ? 'omission' : 'text');
		const regularizedValue =
			kind !== 'text' || text === null
				? { regularizedText: null, ruleIds: [], types: [] as RegularizationType[] }
				: regularizeTextValue(text);
		const ruleIds = options?.ruleIds ?? regularizedValue.ruleIds;
		const regularizationTypes = options?.regularizationTypes ?? regularizedValue.types;
		return {
			text,
			regularizedText: options?.regularizedText ?? regularizedValue.regularizedText,
			alignmentValue:
				options?.alignmentValue ??
				(kind === 'text' ? regularizedValue.regularizedText : null),
			sourceTokenIds: options?.sourceTokenIds ?? [],
			kind,
			gap: options?.gap ?? null,
			isOmission: kind === 'omission',
			isLacuna: options?.isLacuna ?? (kind === 'gap' || kind === 'untranscribed'),
			isRegularized:
				kind === 'text' &&
				text !== null &&
				regularizedValue.regularizedText !== null &&
				text !== regularizedValue.regularizedText,
			ruleIds,
			regularizationTypes,
		};
	}

	function tokenToJoinablePart(token: CollationTokenInput) {
		return {
			text: token.t,
			isPunctuation: token.isPunctuation,
			originalSegments: token.originalSegments,
		};
	}

	function appendTokenText(current: string, token: CollationTokenInput): string {
		return joinTokenTexts([{ text: current }, tokenToJoinablePart(token)]);
	}

	function mergeIgnoredPunctuationIntoPreviousToken(
		tokens: CollationTokenInput[]
	): CollationTokenInput[] {
		if (!ignorePunctuation) return tokens.map(token => ({ ...token }));

		const prepared: CollationTokenInput[] = [];
		for (const token of tokens) {
			const cloned: CollationTokenInput = {
				...token,
				sourceTokenIds: token.sourceTokenIds ? [...token.sourceTokenIds] : undefined,
				originalSegments: token.originalSegments?.map(segment => ({ ...segment })),
				gap: token.gap ? { ...token.gap } : token.gap,
				ruleIds: token.ruleIds ? [...token.ruleIds] : undefined,
				regularizationTypes: token.regularizationTypes
					? [...token.regularizationTypes]
					: undefined,
			};
			if (!isPunctuationToken(tokenToJoinablePart(cloned))) {
				prepared.push(cloned);
				continue;
			}
			const previous = prepared[prepared.length - 1];
			if (!previous || previous.kind !== 'text') continue;
			previous.t = appendTokenText(previous.t, cloned);
			previous.sourceTokenIds = [
				...(previous.sourceTokenIds ?? []),
				...(cloned.sourceTokenIds ?? []),
			];
			previous.originalSegments = [
				...(previous.originalSegments ?? []),
				...(cloned.originalSegments ?? []),
			];
		}
		return prepared;
	}

	function mergeColumns(columnIds: string[]) {
		if (columnIds.length < 2) return;
		const indices = columnIds
			.map(id => alignmentColumns.findIndex(c => c.id === id))
			.filter(i => i >= 0)
			.sort((a, b) => a - b);

		const firstIdx = indices[0];
		const mergedCells = new Map<string, AlignmentCell>();

		for (const wId of witnessOrder) {
			const parts: Array<{
				text: string;
				originalSegments?: WitnessSourceToken['segments'];
			}> = [];
			const sourceTokenIds = new Set<string>();
			let isLacuna = false;
			for (const idx of indices) {
				const cell = alignmentColumns[idx].cells.get(wId);
				if (cell?.text)
					parts.push({ text: cell.text, originalSegments: cell.originalSegments });
				for (const tokenId of cell?.sourceTokenIds ?? []) sourceTokenIds.add(tokenId);
				if (cell?.isLacuna) isLacuna = true;
			}
			mergedCells.set(
				wId,
				makeAlignmentCell(parts.length > 0 ? joinTokenTexts(parts) : null, {
					isLacuna,
					sourceTokenIds: [...sourceTokenIds],
				})
			);
		}

		const prevColumns = alignmentColumns.map(cloneAlignmentColumn);
		const splitInto = indices.map(idx => cloneAlignmentColumn(alignmentColumns[idx]));
		const mergedCol: AlignmentColumn = {
			id: crypto.randomUUID(),
			index: firstIdx,
			cells: mergedCells,
			merged: true,
			mergedWith: columnIds,
			splitInto,
		};

		const newColumns = alignmentColumns.filter(c => !columnIds.includes(c.id));
		newColumns.splice(firstIdx, 0, mergedCol);
		newColumns.forEach((c, i) => (c.index = i));
		alignmentColumns = newColumns;

		pushCommand({
			type: 'merge-columns',
			description: `Merge ${columnIds.length} units`,
			undo: () => {
				alignmentColumns = prevColumns;
			},
			redo: () => {
				alignmentColumns = newColumns;
			},
		});
		selectedColumnIds = new Set();
	}

	function makeCellSelectionKey(witnessId: string, columnId: string): string {
		return `${witnessId}::${columnId}`;
	}

	function parseCellSelectionKey(key: string): { witnessId: string; columnId: string } | null {
		const idx = key.indexOf('::');
		if (idx < 0) return null;
		return {
			witnessId: key.slice(0, idx),
			columnId: key.slice(idx + 2),
		};
	}

	function toggleCellSelection(columnId: string, witnessId: string) {
		const key = makeCellSelectionKey(witnessId, columnId);
		const next = new Set(selectedCells);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedCells = next;
	}

	function selectCellRange(witnessId: string, startColumnId: string, endColumnId: string) {
		const startIdx = alignmentColumns.findIndex(c => c.id === startColumnId);
		const endIdx = alignmentColumns.findIndex(c => c.id === endColumnId);
		if (startIdx < 0 || endIdx < 0) return;
		const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
		const next = new Set(selectedCells);
		for (let i = from; i <= to; i++) {
			next.add(makeCellSelectionKey(witnessId, alignmentColumns[i].id));
		}
		selectedCells = next;
	}

	function clearCellSelection() {
		selectedCells = new Set();
	}

	function canMergeSelectedCells(): boolean {
		if (selectedCells.size < 2) return false;
		const parsed = [...selectedCells]
			.map(parseCellSelectionKey)
			.filter((entry): entry is { witnessId: string; columnId: string } => entry !== null);
		if (parsed.length < 2) return false;
		const witnessId = parsed[0].witnessId;
		if (!parsed.every(entry => entry.witnessId === witnessId)) return false;

		const indices = parsed
			.map(entry => alignmentColumns.findIndex(c => c.id === entry.columnId))
			.filter(idx => idx >= 0)
			.sort((a, b) => a - b);
		if (indices.length < 2) return false;
		for (let i = 1; i < indices.length; i++) {
			if (indices[i] !== indices[i - 1] + 1) return false;
		}
		return true;
	}

	function mergeSelectedCells() {
		if (!canMergeSelectedCells()) return;
		const parsed = [...selectedCells]
			.map(parseCellSelectionKey)
			.filter((entry): entry is { witnessId: string; columnId: string } => entry !== null);
		const witnessId = parsed[0].witnessId;
		const indices = parsed
			.map(entry => alignmentColumns.findIndex(c => c.id === entry.columnId))
			.filter(idx => idx >= 0)
			.sort((a, b) => a - b);

		const firstIdx = indices[0];
		const prevColumns = alignmentColumns.map(col => ({
			...col,
			cells: new Map(col.cells),
		}));
		const parts: Array<{ text: string; originalSegments?: WitnessSourceToken['segments'] }> =
			[];
		const sourceTokenIds = new Set<string>();
		let isLacuna = false;
		for (const idx of indices) {
			const cell = alignmentColumns[idx].cells.get(witnessId);
			if (cell?.text && cell.text.trim()) {
				parts.push({ text: cell.text.trim(), originalSegments: cell.originalSegments });
			}
			for (const tokenId of cell?.sourceTokenIds ?? []) sourceTokenIds.add(tokenId);
			if (cell?.isLacuna) isLacuna = true;
		}

		const mergedText = parts.length > 0 ? joinTokenTexts(parts) : null;
		alignmentColumns[firstIdx].cells.set(
			witnessId,
			makeAlignmentCell(mergedText, {
				isLacuna,
				sourceTokenIds: [...sourceTokenIds],
			})
		);
		for (const idx of indices.slice(1)) {
			alignmentColumns[idx].cells.set(witnessId, makeAlignmentCell(null));
		}
		alignmentColumns = [...alignmentColumns];

		pushCommand({
			type: 'merge-cells',
			description: `Merge ${indices.length} adjacent cells for ${witnessId}`,
			undo: () => {
				alignmentColumns = prevColumns;
			},
			redo: () => {
				const nextColumns = prevColumns.map(col => ({
					...col,
					cells: new Map(col.cells),
				}));
				nextColumns[firstIdx].cells.set(
					witnessId,
					makeAlignmentCell(mergedText, {
						isLacuna,
						sourceTokenIds: [...sourceTokenIds],
					})
				);
				for (const idx of indices.slice(1)) {
					nextColumns[idx].cells.set(witnessId, makeAlignmentCell(null));
				}
				alignmentColumns = nextColumns;
			},
		});
		selectedCells = new Set();
	}

	function expandColumnByWhitespace(column: AlignmentColumn): AlignmentColumn[] {
		const witnessIds = witnessOrder.length > 0 ? witnessOrder : [...column.cells.keys()];
		const tokenizedByWitness = new Map<string, string[]>();
		let maxWords = 1;
		for (const witnessId of witnessIds) {
			const cell = column.cells.get(witnessId);
			const words =
				cell && !cell.isOmission && cell.text ? tokenizeDisplayText(cell.text) : [];
			tokenizedByWitness.set(witnessId, words);
			if (words.length > maxWords) maxWords = words.length;
		}

		return Array.from({ length: maxWords }, (_, wordIdx) => {
			const cells = new Map<string, AlignmentCell>();
			for (const witnessId of witnessIds) {
				const sourceCell = column.cells.get(witnessId);
				const words = tokenizedByWitness.get(witnessId) ?? [];
				const token = words[wordIdx] ?? null;
				const sourceTokenIds =
					token !== null && sourceCell?.sourceTokenIds?.length
						? sourceCell.sourceTokenIds.slice(wordIdx, wordIdx + 1)
						: [];
				cells.set(
					witnessId,
					makeAlignmentCell(token, {
						isLacuna: sourceCell?.isLacuna ?? false,
						sourceTokenIds,
					})
				);
			}
			return {
				id: crypto.randomUUID(),
				index: wordIdx,
				cells,
				merged: false,
			};
		});
	}

	function splitColumn(columnId: string) {
		const colIdx = alignmentColumns.findIndex(c => c.id === columnId);
		if (colIdx < 0) return;
		const col = alignmentColumns[colIdx];
		if (!canSplitColumn(columnId)) return;

		const prevColumns = alignmentColumns.map(cloneAlignmentColumn);
		let restored: AlignmentColumn[];
		if (col.merged && col.splitInto && col.splitInto.length > 0) {
			restored = col.splitInto.map(cloneAlignmentColumn);
		} else {
			restored = expandColumnByWhitespace(col);
		}

		const newColumns = [
			...alignmentColumns.slice(0, colIdx),
			...restored,
			...alignmentColumns.slice(colIdx + 1),
		];
		newColumns.forEach((c, i) => (c.index = i));
		alignmentColumns = newColumns;

		pushCommand({
			type: 'split-column',
			description: `Split alignment unit`,
			undo: () => {
				alignmentColumns = prevColumns.map(cloneAlignmentColumn);
			},
			redo: () => {
				alignmentColumns = newColumns.map(cloneAlignmentColumn);
			},
		});
	}

	function canSplitColumn(columnId: string): boolean {
		const col = alignmentColumns.find(c => c.id === columnId);
		if (!col) return false;
		if (col.merged) return true;
		return [...col.cells.values()].some(
			cell =>
				Boolean(cell?.text) && (cell?.text ? tokenizeDisplayText(cell.text).length : 0) > 1
		);
	}

	function countWords(text: string): number {
		return tokenizeDisplayText(text).length;
	}

	function getDisplayedColumnSlots(
		columns: AlignmentColumn[] = alignmentColumns
	): DisplayedColumnSlot[] {
		const baseId = getBaseWitnessId();
		if (!baseId) {
			return columns.map((column, index) => ({
				columnId: column.id,
				columnIndex: index,
				start: index + 1,
				end: index + 1,
			}));
		}

		let lastEvenIndex = 0;
		return columns.map((column, index) => {
			const cell = column.cells.get(baseId);
			if (cell && !cell.isOmission && cell.text && cell.text.trim().length > 0) {
				const words = Math.max(1, countWords(cell.text));
				const start = lastEvenIndex + 2;
				const end = start + (words - 1) * 2;
				lastEvenIndex = end;
				return { columnId: column.id, columnIndex: index, start, end };
			}

			const position = lastEvenIndex + 1;
			return { columnId: column.id, columnIndex: index, start: position, end: position };
		});
	}

	function findDisplayedColumnSlotById(
		columnId: string,
		columns: AlignmentColumn[] = alignmentColumns
	): DisplayedColumnSlot | null {
		return getDisplayedColumnSlots(columns).find(slot => slot.columnId === columnId) ?? null;
	}

	function findDisplayedColumnSlotByPosition(
		position: number,
		columns: AlignmentColumn[] = alignmentColumns
	): DisplayedColumnSlot | null {
		return (
			getDisplayedColumnSlots(columns).find(
				slot => slot.start <= position && position <= slot.end
			) ?? null
		);
	}

	function insertEmptyAlignmentColumn(
		columns: AlignmentColumn[],
		atIndex: number
	): AlignmentColumn[] {
		const witnessIds =
			witnessOrder.length > 0 ? witnessOrder : [...new Set(witnesses.map(w => w.witnessId))];
		const cells = new Map<string, AlignmentCell>();
		for (const witnessId of witnessIds) {
			cells.set(witnessId, makeAlignmentCell(null));
		}
		const nextColumns = columns.map(cloneAlignmentColumn);
		nextColumns.splice(atIndex, 0, {
			id: crypto.randomUUID(),
			index: atIndex,
			cells,
			merged: false,
		});
		nextColumns.forEach((column, index) => (column.index = index));
		return nextColumns;
	}

	function isColumnFullyEmpty(column: AlignmentColumn): boolean {
		return [...column.cells.values()].every(cell => cell.isOmission && !cell.text);
	}

	function pruneEmptyColumnById(columns: AlignmentColumn[], columnId: string): AlignmentColumn[] {
		const nextColumns = columns.map(cloneAlignmentColumn);
		const index = nextColumns.findIndex(column => column.id === columnId);
		if (index < 0 || !isColumnFullyEmpty(nextColumns[index])) {
			return nextColumns;
		}
		nextColumns.splice(index, 1);
		nextColumns.forEach((column, columnIndex) => (column.index = columnIndex));
		return nextColumns;
	}

	function resolveShiftTarget(
		columnId: string,
		direction: 'left' | 'right',
		columns: AlignmentColumn[] = alignmentColumns
	): {
		columns: AlignmentColumn[];
		sourceIndex: number;
		targetIndex: number;
		sourceColumnId: string;
		targetColumnId: string;
	} | null {
		const sourceSlot = findDisplayedColumnSlotById(columnId, columns);
		if (!sourceSlot) return null;

		const targetPosition = direction === 'left' ? sourceSlot.start - 1 : sourceSlot.end + 1;
		if (targetPosition < 1) return null;

		const targetSlot = findDisplayedColumnSlotByPosition(targetPosition, columns);
		if (targetSlot) {
			return {
				columns,
				sourceIndex: sourceSlot.columnIndex,
				targetIndex: targetSlot.columnIndex,
				sourceColumnId: sourceSlot.columnId,
				targetColumnId: targetSlot.columnId,
			};
		}

		const insertionIndex =
			direction === 'left' ? sourceSlot.columnIndex : sourceSlot.columnIndex + 1;
		const expandedColumns = insertEmptyAlignmentColumn(columns, insertionIndex);
		const expandedSourceSlot = findDisplayedColumnSlotById(columnId, expandedColumns);
		const expandedTargetSlot = findDisplayedColumnSlotByPosition(
			targetPosition,
			expandedColumns
		);
		if (!expandedSourceSlot || !expandedTargetSlot) return null;
		return {
			columns: expandedColumns,
			sourceIndex: expandedSourceSlot.columnIndex,
			targetIndex: expandedTargetSlot.columnIndex,
			sourceColumnId: expandedSourceSlot.columnId,
			targetColumnId: expandedTargetSlot.columnId,
		};
	}

	function canShiftToken(
		columnId: string,
		witnessId: string,
		direction: 'left' | 'right'
	): boolean {
		const sourceSlot = findDisplayedColumnSlotById(columnId);
		if (!sourceSlot) return false;
		const sourceCell = alignmentColumns[sourceSlot.columnIndex]?.cells.get(witnessId);
		if (!sourceCell || sourceCell.isOmission || !sourceCell.text) return false;

		const targetPosition = direction === 'left' ? sourceSlot.start - 1 : sourceSlot.end + 1;
		if (targetPosition < 1) return false;

		const targetSlot = findDisplayedColumnSlotByPosition(targetPosition);
		if (!targetSlot) return true;

		const targetCell = alignmentColumns[targetSlot.columnIndex]?.cells.get(witnessId);
		return Boolean(targetCell && targetCell.isOmission && !targetCell.text);
	}

	function shiftToken(columnId: string, witnessId: string, direction: 'left' | 'right') {
		const sourceSlot = findDisplayedColumnSlotById(columnId);
		if (!sourceSlot) return;
		const sourceCell = alignmentColumns[sourceSlot.columnIndex]?.cells.get(witnessId);
		if (!sourceCell || sourceCell.isOmission || !sourceCell.text) return;

		const prevColumns = alignmentColumns.map(cloneAlignmentColumn);
		const resolvedTarget = resolveShiftTarget(columnId, direction, prevColumns);
		if (!resolvedTarget) return;

		const nextColumns = resolvedTarget.columns.map(cloneAlignmentColumn);
		const targetCell = nextColumns[resolvedTarget.targetIndex]?.cells.get(witnessId);
		if (!targetCell || !targetCell.isOmission || targetCell.text) return;

		nextColumns[resolvedTarget.targetIndex].cells.set(witnessId, { ...sourceCell });
		nextColumns[resolvedTarget.sourceIndex].cells.set(
			witnessId,
			makeAlignmentCell(null, { isLacuna: sourceCell.isLacuna })
		);
		alignmentColumns = pruneEmptyColumnById(nextColumns, resolvedTarget.sourceColumnId);

		pushCommand({
			type: 'shift-token',
			description: `Shift token ${direction}`,
			undo: () => {
				alignmentColumns = prevColumns.map(cloneAlignmentColumn);
			},
			redo: () => {
				const redoTarget = resolveShiftTarget(columnId, direction, prevColumns);
				if (!redoTarget) {
					alignmentColumns = prevColumns.map(cloneAlignmentColumn);
					return;
				}
				const redoColumns = redoTarget.columns.map(cloneAlignmentColumn);
				const redoTargetCell = redoColumns[redoTarget.targetIndex]?.cells.get(witnessId);
				if (!redoTargetCell || !redoTargetCell.isOmission || redoTargetCell.text) {
					alignmentColumns = prevColumns.map(cloneAlignmentColumn);
					return;
				}
				redoColumns[redoTarget.targetIndex].cells.set(witnessId, { ...sourceCell });
				redoColumns[redoTarget.sourceIndex].cells.set(
					witnessId,
					makeAlignmentCell(null, { isLacuna: sourceCell.isLacuna })
				);
				alignmentColumns = pruneEmptyColumnById(redoColumns, redoTarget.sourceColumnId);
			},
		});
	}

	// Column selection for alignment
	function toggleColumnSelection(columnId: string) {
		const next = new Set(selectedColumnIds);
		if (next.has(columnId)) {
			next.delete(columnId);
		} else {
			next.add(columnId);
		}
		selectedColumnIds = next;
	}

	function clearColumnSelection() {
		selectedColumnIds = new Set();
	}

	function getBaseWitnessId(): string | null {
		const active = witnesses.filter(w => !w.isExcluded);
		if (active.length === 0) return null;
		return active.find(w => w.isBaseText)?.witnessId ?? active[0].witnessId;
	}

	function getOrderedActiveWitnessIds(): string[] {
		const activeIds = new Set(witnesses.filter(w => !w.isExcluded).map(w => w.witnessId));
		const baseId = getBaseWitnessId();
		const ordered: string[] = [];

		if (baseId && activeIds.has(baseId)) {
			ordered.push(baseId);
			activeIds.delete(baseId);
		}

		for (const id of witnessOrder) {
			if (activeIds.has(id)) {
				ordered.push(id);
				activeIds.delete(id);
			}
		}

		for (const witness of witnesses) {
			if (activeIds.has(witness.witnessId)) {
				ordered.push(witness.witnessId);
				activeIds.delete(witness.witnessId);
			}
		}

		return ordered;
	}

	function getWitnessTokensFromAlignment(witnessId: string): string[] {
		const tokens: string[] = [];
		for (const col of alignmentColumns) {
			const cell = col.cells.get(witnessId);
			if (!cell || cell.isOmission || !cell.text) continue;
			const text = cell.text.trim();
			if (text.length > 0) tokens.push(text);
		}
		return tokens;
	}

	// Phase 4: Stemma
	function getVariationUnitSpans() {
		return buildVariationUnitSpans(alignmentColumns);
	}

	function getVariationUnitSpan(unitIndex: number): VariationUnitSpan | null {
		const spans = getVariationUnitSpans();
		if (spans.length === 0) {
			if (unitIndex < 0 || unitIndex >= alignmentColumns.length) return null;
			const column = alignmentColumns[unitIndex];
			if (!column) return null;
			return {
				startIndex: unitIndex,
				endIndex: unitIndex,
				columnIds: [column.id],
			};
		}
		return (
			spans.find(span => span.startIndex === unitIndex) ??
			spans.find(span => unitIndex >= span.startIndex && unitIndex <= span.endIndex) ??
			spans[0] ??
			null
		);
	}

	function normalizeVariationUnitIndex(unitIndex: number): number {
		return getVariationUnitSpan(unitIndex)?.startIndex ?? 0;
	}

	function getColumnsForUnit(unitIndex: number): AlignmentColumn[] {
		const span = getVariationUnitSpan(unitIndex);
		if (!span) return [];
		return alignmentColumns.slice(span.startIndex, span.endIndex + 1);
	}

	function getCellsForUnit(unitIndex: number, witnessId: string): AlignmentCell[] {
		return getColumnsForUnit(unitIndex)
			.map(column => column.cells.get(witnessId))
			.filter((cell): cell is AlignmentCell => Boolean(cell));
	}

	function getReadingUnitKey(unitIndex: number): string {
		return String(normalizeVariationUnitIndex(unitIndex));
	}

	function makeWitnessGroups(witnessIds: string[]) {
		if (witnessIds.length === 0) return [];
		return [{ id: crypto.randomUUID(), witnessIds: [...witnessIds] }];
	}

	function joinCellsText(cells: AlignmentCell[], mode: 'original' | 'normalized'): string | null {
		const value = joinTokenTexts(
			cells.map(cell => ({
				text: mode === 'normalized' ? (cell.regularizedText ?? cell.text) : cell.text,
				originalSegments: cell.originalSegments,
				isPunctuation:
					mode === 'normalized'
						? false
						: isPunctuationToken({
								text: cell.text ?? '',
								originalSegments: cell.originalSegments,
							}),
			}))
		);
		return value.length > 0 ? value : null;
	}

	function getBaseTextForVariationUnit(unitIndex: number): string {
		const baseWitnessId = getBaseWitnessId();
		if (!baseWitnessId) return '';
		return joinCellsText(getCellsForUnit(unitIndex, baseWitnessId), 'original') ?? '';
	}

	function getSourceWitnessIdsForColumns(columns: AlignmentColumn[]): string[] {
		const ordered = getOrderedActiveWitnessIds();
		if (ordered.length > 0) return ordered;
		const seen = new Set<string>();
		const collected: string[] = [];
		for (const column of columns) {
			for (const witnessId of column.cells.keys()) {
				if (seen.has(witnessId)) continue;
				seen.add(witnessId);
				collected.push(witnessId);
			}
		}
		return collected;
	}

	function getReadingFamilyKey(reading: Pick<ClassifiedReading, 'normalizedText' | 'text' | 'isOmission' | 'isLacuna'>): string {
		if (reading.isOmission) return '__OMISSION__';
		if (reading.isLacuna) return '__LACUNA__';
		return reading.normalizedText ?? reading.text ?? '__EMPTY__';
	}

	function compareReadingsForPriority(
		a: Pick<ClassifiedReading, 'text' | 'witnessIds'>,
		b: Pick<ClassifiedReading, 'text' | 'witnessIds'>,
		baseWitnessId: string | null
	): number {
		const aHasBase = baseWitnessId ? a.witnessIds.includes(baseWitnessId) : false;
		const bHasBase = baseWitnessId ? b.witnessIds.includes(baseWitnessId) : false;
		if (aHasBase !== bHasBase) return aHasBase ? -1 : 1;
		if (a.witnessIds.length !== b.witnessIds.length)
			return b.witnessIds.length - a.witnessIds.length;
		return (a.text ?? '').localeCompare(b.text ?? '');
	}

	function compareReadingsForOrder(
		a: Pick<ClassifiedReading, 'order' | 'text' | 'witnessIds'>,
		b: Pick<ClassifiedReading, 'order' | 'text' | 'witnessIds'>,
		baseWitnessId: string | null
	): number {
		if (a.order !== b.order) return a.order - b.order;
		return compareReadingsForPriority(a, b, baseWitnessId);
	}

	function buildClassifiedReadingsFromFamilyGroups(
		groups: ReadingFamilyGroup[],
	): ClassifiedReading[] {
		const readings: ClassifiedReading[] = [];
		for (const [groupIndex, group] of groups.entries()) {
			const members = [group.parent, ...group.children];
			for (const [memberIndex, member] of members.entries()) {
				const parentId = memberIndex === 0 ? null : group.parent.id;
				readings.push({
					id: member.id,
					order: memberIndex === 0 ? groupIndex : memberIndex - 1,
					label: '',
					text: member.originalText,
					normalizedText: member.normalizedText,
					witnessIds: [...member.witnessIds],
					witnessGroups: makeWitnessGroups(member.witnessIds),
					classification: 'unclassified',
					isOmission: member.isOmission,
					isLacuna: member.isLacuna,
					readingType: parentId ? ('ns' as const) : null,
					parentReadingId: parentId,
					isSubreading: parentId !== null,
					autoGenerated: parentId !== null,
					derivedFromRuleIds: [...member.ruleIds],
				});
			}
		}
		return readings;
	}

	function canonicalizeReadings(readings: ClassifiedReading[]): ClassifiedReading[] {
		const byId = new Map(readings.map(reading => [reading.id, reading] as const));
		const normalized = readings.map(reading => {
			const parentExists =
				reading.parentReadingId !== null &&
				reading.parentReadingId !== reading.id &&
				byId.has(reading.parentReadingId);
			return {
				...reading,
				parentReadingId: parentExists ? reading.parentReadingId : null,
				isSubreading: parentExists,
				witnessGroups: makeWitnessGroups(reading.witnessIds),
			};
		});

		const readingsByFamilyKey = new Map<string, ClassifiedReading[]>();
		for (const reading of normalized) {
			const key = getReadingFamilyKey(reading);
			const existing = readingsByFamilyKey.get(key) ?? [];
			existing.push(reading);
			readingsByFamilyKey.set(key, existing);
		}

		const updates = new Map<string, ClassifiedReading>();
		for (const family of readingsByFamilyKey.values()) {
			const sortedFamily = [...family].sort((a, b) => compareReadingsForOrder(a, b, getBaseWitnessId()));
			const explicitParent =
				sortedFamily.find(candidate =>
					sortedFamily.some(reading => reading.parentReadingId === candidate.id)
				) ?? null;
			const preferredParent = explicitParent ?? sortedFamily[0] ?? null;
			if (!preferredParent) continue;

			updates.set(preferredParent.id, {
				...preferredParent,
				parentReadingId: null,
				isSubreading: false,
				readingType: preferredParent.isOmission || preferredParent.isLacuna ? null : null,
				autoGenerated: preferredParent.autoGenerated && family.length > 1,
			});

			let childOrder = 0;
			for (const reading of sortedFamily) {
				if (reading.id === preferredParent.id) continue;
				const shouldBeSubreading = !reading.isOmission && !reading.isLacuna;
				updates.set(reading.id, {
					...reading,
					order: childOrder,
					parentReadingId: shouldBeSubreading ? preferredParent.id : null,
					isSubreading: shouldBeSubreading,
					readingType: shouldBeSubreading ? ('ns' as const) : null,
					autoGenerated: shouldBeSubreading ? reading.autoGenerated || family.length > 1 : false,
				});
				childOrder += 1;
			}
		}

		return relabelReadings(normalized.map(reading => updates.get(reading.id) ?? reading));
	}

	function normalizeReadingOrders(readings: ClassifiedReading[]): ClassifiedReading[] {
		const baseWitnessId = getBaseWitnessId();
		const primaryReadings = readings.filter(reading => reading.parentReadingId === null);
		const sortedPrimary = [...primaryReadings].sort((a, b) =>
			compareReadingsForOrder(a, b, baseWitnessId)
		);

		const normalizedById = new Map<string, ClassifiedReading>();
		sortedPrimary.forEach((reading, index) => {
			normalizedById.set(reading.id, { ...reading, order: index });
		});

		for (const parent of sortedPrimary) {
			const children = readings
				.filter(reading => reading.parentReadingId === parent.id)
				.sort((a, b) => compareReadingsForOrder(a, b, baseWitnessId));
			children.forEach((reading, index) => {
				normalizedById.set(reading.id, { ...reading, order: index });
			});
		}

		for (const reading of readings) {
			if (!normalizedById.has(reading.id)) {
				normalizedById.set(reading.id, { ...reading, order: reading.order ?? 0 });
			}
		}

		return readings.map(reading => normalizedById.get(reading.id) ?? reading);
	}

	function relabelReadings(readings: ClassifiedReading[]): ClassifiedReading[] {
		const baseWitnessId = getBaseWitnessId();
		const normalized = normalizeReadingOrders(readings);
		const primaryReadings = normalized.filter(reading => reading.parentReadingId === null);
		const sortedPrimary = [...primaryReadings].sort((a, b) =>
			compareReadingsForOrder(a, b, baseWitnessId)
		);

		const primaryLabelById = new Map<string, string>();
		for (const [index, reading] of sortedPrimary.entries()) {
			primaryLabelById.set(reading.id, indexToReadingLabel(index));
		}

		const subreadingsByParent = new Map<string, ClassifiedReading[]>();
		for (const reading of normalized) {
			if (!reading.parentReadingId) continue;
			const existing = subreadingsByParent.get(reading.parentReadingId) ?? [];
			existing.push(reading);
			subreadingsByParent.set(reading.parentReadingId, existing);
		}

		const subLabelById = new Map<string, string>();
		for (const [parentId, children] of subreadingsByParent.entries()) {
			const parentLabel = primaryLabelById.get(parentId);
			if (!parentLabel) continue;
			children
				.sort((a, b) => compareReadingsForOrder(a, b, baseWitnessId))
				.forEach((child, index) => {
					subLabelById.set(child.id, `${parentLabel}${index + 1}`);
				});
		}

		return normalized
			.map(reading => ({
				...reading,
				witnessGroups: makeWitnessGroups(reading.witnessIds),
				label:
					reading.parentReadingId === null
						? (primaryLabelById.get(reading.id) ?? '?')
						: (subLabelById.get(reading.id) ?? '?'),
			}))
			.sort((a, b) => {
				if ((a.parentReadingId ?? '') !== (b.parentReadingId ?? '')) {
					if (a.parentReadingId === null && b.parentReadingId !== null) return -1;
					if (a.parentReadingId !== null && b.parentReadingId === null) return 1;
					return (a.parentReadingId ?? '').localeCompare(b.parentReadingId ?? '');
				}
				return a.order - b.order;
			});
	}

	function buildReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		const span = getVariationUnitSpan(unitIndex);
		if (!span) return [];
		const columns = getColumnsForUnit(span.startIndex);
		const baseWitnessId = getBaseWitnessId();
		const sourceWitnessIds = getSourceWitnessIdsForColumns(columns);

		const groups = buildReadingFamilyGroups({
			entries: sourceWitnessIds.map(witnessId => ({
				witnessId,
				cells: columns.map(column => column.cells.get(witnessId)),
			})),
			baseWitnessId,
			columnId: span.columnIds.join('+'),
		});

		return canonicalizeReadings(buildClassifiedReadingsFromFamilyGroups(groups));
	}

	function ensureReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		const key = getReadingUnitKey(unitIndex);
		const existing = classifiedReadings.get(key);
		if (existing) return existing;
		const built = buildReadingsForUnit(unitIndex);
		classifiedReadings = new Map(classifiedReadings).set(key, built);
		return built;
	}

	function peekReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		return (
			classifiedReadings.get(getReadingUnitKey(unitIndex)) ?? buildReadingsForUnit(unitIndex)
		);
	}

	function getReadingFamiliesForUnit(unitIndex: number): ReadingFamilyView[] {
		const readings = peekReadingsForUnit(unitIndex);
		const byId = new Map(readings.map(reading => [reading.id, reading] as const));
		const primaries = readings
			.filter(reading => reading.parentReadingId === null)
			.sort((a, b) => compareReadingsForOrder(a, b, getBaseWitnessId()));
		return primaries.map(parent => {
			const children = readings
				.filter(reading => reading.parentReadingId === parent.id)
				.sort((a, b) => compareReadingsForOrder(a, b, getBaseWitnessId()));
			const members = [parent, ...children];
			return {
				id: parent.id,
				familyKey: getReadingFamilyKey(parent),
				parent,
				children,
				members: members.filter(reading => byId.has(reading.id)),
			};
		});
	}

	function getDisplayedWitnessIdsForReading(
		unitIndex: number,
		readingId: string,
		displayMode: AlignmentDisplayMode
	): string[] {
		const readings = peekReadingsForUnit(unitIndex);
		const reading = readings.find(entry => entry.id === readingId);
		if (!reading) return [];
		if (displayMode !== 'regularized' || reading.parentReadingId !== null) {
			return [...reading.witnessIds];
		}

		const family = getReadingFamiliesForUnit(unitIndex).find(entry => entry.parent.id === readingId);
		if (!family) return [...reading.witnessIds];

		const witnessIds: string[] = [];
		const seen = new Set<string>();
		for (const member of family.members) {
			for (const witnessId of member.witnessIds) {
				if (seen.has(witnessId)) continue;
				seen.add(witnessId);
				witnessIds.push(witnessId);
			}
		}
		return witnessIds;
	}

	function getReadingDisplayValuesForUnit(unitIndex: number): Map<string, ReadingDisplayValue> {
		const span = getVariationUnitSpan(unitIndex);
		if (!span) return new Map();
		const columns = getColumnsForUnit(span.startIndex);
		const sourceWitnessIds = getSourceWitnessIdsForColumns(columns);
		const groups = buildReadingFamilyGroups({
			entries: sourceWitnessIds.map(witnessId => ({
				witnessId,
				cells: columns.map(column => column.cells.get(witnessId)),
			})),
			baseWitnessId: getBaseWitnessId(),
			columnId: span.columnIds.join('+'),
		});
		const displayValues = new Map<string, ReadingDisplayValue>();
		for (const group of groups) {
			for (const member of [group.parent, ...group.children]) {
				displayValues.set(member.id, {
					sourceOriginalText: member.originalText,
					sourceNormalizedText: member.normalizedText,
					originalDisplayText: readingText(member),
					regularizedDisplayText:
						member.isOmission || member.isLacuna
							? readingText(member)
							: (member.normalizedText ?? readingText(member)),
				});
			}
		}
		return displayValues;
	}

	function getReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		return ensureReadingsForUnit(unitIndex);
	}

	function primeReadingsForUnit(unitIndex: number): void {
		void ensureReadingsForUnit(unitIndex);
	}

	function setReadingsForUnit(unitIndex: number, readings: ClassifiedReading[]) {
		const key = getReadingUnitKey(unitIndex);
		classifiedReadings = new Map(classifiedReadings).set(key, canonicalizeReadings(readings));
		markUnsaved();
	}

	function classifyReading(
		unitIndex: number,
		readingId: string,
		classification: ReadingClassification
	) {
		const readings = ensureReadingsForUnit(unitIndex);
		if (readings.length === 0) return;
		const updated = readings.map(r => (r.id === readingId ? { ...r, classification } : r));
		setReadingsForUnit(unitIndex, updated);
	}

	function splitWitnessFromReading(unitIndex: number, readingId: string, witnessId: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const source = readings.find(reading => reading.id === readingId);
		if (!source || source.witnessIds.length < 2 || !source.witnessIds.includes(witnessId))
			return;
		const nextOrder =
			Math.max(
				-1,
				...readings
					.filter(reading => reading.parentReadingId === source.parentReadingId)
					.map(reading => reading.order)
			) + 1;

		const updated = readings.map(reading => {
			if (reading.id !== readingId) return reading;
			return {
				...reading,
				witnessIds: reading.witnessIds.filter(id => id !== witnessId),
			};
		});

		updated.push({
			...source,
			id: crypto.randomUUID(),
			order: nextOrder,
			label: '',
			witnessIds: [witnessId],
			witnessGroups: makeWitnessGroups([witnessId]),
			autoGenerated: false,
		});

		setReadingsForUnit(unitIndex, updated);
	}

	function setReadingParent(
		unitIndex: number,
		readingId: string,
		parentReadingId: string | null
	) {
		const readings = ensureReadingsForUnit(unitIndex);
		const target = readings.find(reading => reading.id === readingId);
		const parent = parentReadingId
			? readings.find(reading => reading.id === parentReadingId) ?? null
			: null;
		if (!target) return;
		if (parent && getReadingFamilyKey(parent) !== getReadingFamilyKey(target)) return;
		const nextOrder =
			Math.max(
				-1,
				...readings
					.filter(
						reading =>
							reading.parentReadingId === parentReadingId && reading.id !== readingId
					)
					.map(reading => reading.order)
			) + 1;
		const updated = readings.map(reading => {
			if (reading.id !== readingId) return reading;
			return {
				...reading,
				order: nextOrder,
				parentReadingId,
				isSubreading: parentReadingId !== null,
				autoGenerated: false,
			};
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function promoteReadingAsFamilyParent(unitIndex: number, readingId: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const target = readings.find(reading => reading.id === readingId);
		if (!target) return;
		const familyKey = getReadingFamilyKey(target);
		const family = readings.filter(reading => getReadingFamilyKey(reading) === familyKey);
		if (family.length < 2) return;
		const updated = readings.map(reading => {
			if (getReadingFamilyKey(reading) !== familyKey) return reading;
			if (reading.id === readingId) {
				return {
					...reading,
					order: Math.min(...family.map(member => member.order)),
					parentReadingId: null,
					isSubreading: false,
					readingType: null,
					autoGenerated: false,
				};
			}
			return {
				...reading,
				parentReadingId: readingId,
				isSubreading: !reading.isOmission && !reading.isLacuna,
				readingType: !reading.isOmission && !reading.isLacuna ? ('ns' as const) : null,
			};
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function updateReadingText(unitIndex: number, readingId: string, text: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const nextText = text.trim();
		const updated = readings.map(reading => {
			if (reading.id !== readingId) return reading;
			return {
				...reading,
				text: nextText.length > 0 ? nextText : null,
				normalizedText: nextText.length > 0 ? nextText : null,
				isOmission: false,
				isLacuna: false,
			};
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function updateReadingTextForDisplayMode(
		unitIndex: number,
		readingId: string,
		text: string,
		displayMode: AlignmentDisplayMode
	) {
		if (displayMode === 'original') {
			updateReadingText(unitIndex, readingId, text);
			return;
		}
		const readings = ensureReadingsForUnit(unitIndex);
		const nextText = text.trim();
		const updated = readings.map(reading => {
			if (reading.id !== readingId) return reading;
			const nextNormalized = nextText.length > 0 ? nextText : null;
			const shouldMirrorText =
				reading.parentReadingId === null &&
				(reading.text === reading.normalizedText || reading.text === null);
			return {
				...reading,
				text: shouldMirrorText ? nextNormalized : reading.text,
				normalizedText: nextNormalized,
				isOmission: false,
				isLacuna: false,
			};
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function setReadingEditorType(
		unitIndex: number,
		readingId: string,
		readingType: ReadingEditorType
	) {
		const readings = ensureReadingsForUnit(unitIndex);
		const updated = readings.map(reading => {
			if (reading.id !== readingId) return reading;
			if (readingType === 'om') {
				return {
					...reading,
					text: null,
					normalizedText: null,
					isOmission: true,
					isLacuna: false,
					readingType: null,
				};
			}
			if (readingType === 'lac') {
				return {
					...reading,
					text: null,
					normalizedText: null,
					isOmission: false,
					isLacuna: true,
					readingType: null,
				};
			}
			return {
				...reading,
				isOmission: false,
				isLacuna: false,
				readingType: readingType === 'ns' ? ('ns' as const) : null,
			};
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function addReading(unitIndex: number, options?: { parentReadingId?: string | null }) {
		const readings = ensureReadingsForUnit(unitIndex);
		const parentReadingId = options?.parentReadingId ?? null;
		const nextOrder =
			Math.max(
				-1,
				...readings
					.filter(reading => reading.parentReadingId === parentReadingId)
					.map(reading => reading.order)
			) + 1;
		const reading: ClassifiedReading = {
			id: crypto.randomUUID(),
			order: nextOrder,
			label: '',
			text: null,
			normalizedText: null,
			witnessIds: [],
			witnessGroups: [],
			classification: 'unclassified',
			isOmission: false,
			isLacuna: false,
			readingType: null,
			parentReadingId,
			isSubreading: parentReadingId !== null,
			autoGenerated: false,
			derivedFromRuleIds: [],
		};
		setReadingsForUnit(unitIndex, [...readings, reading]);
		return reading.id;
	}

	function deleteReading(unitIndex: number, readingId: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const target = readings.find(reading => reading.id === readingId);
		if (!target || target.witnessIds.length > 0) return;
		const updated = readings
			.filter(reading => reading.id !== readingId)
			.map(reading =>
				reading.parentReadingId === readingId
					? {
							...reading,
							parentReadingId: null,
							isSubreading: false,
						}
					: reading
			);
		setReadingsForUnit(unitIndex, updated);
	}

	function moveWitnessToReading(unitIndex: number, witnessId: string, targetReadingId: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const sourceReading = readings.find(reading => reading.witnessIds.includes(witnessId));
		const targetReading = readings.find(reading => reading.id === targetReadingId);
		if (!sourceReading || !targetReading || sourceReading.id === targetReading.id) return;

		const updated = readings.map(reading => {
			if (reading.id === sourceReading.id) {
				return {
					...reading,
					witnessIds: reading.witnessIds.filter(id => id !== witnessId),
				};
			}
			if (reading.id === targetReading.id) {
				return {
					...reading,
					witnessIds: reading.witnessIds.includes(witnessId)
						? reading.witnessIds
						: [...reading.witnessIds, witnessId],
				};
			}
			return reading;
		});
		setReadingsForUnit(unitIndex, updated);
	}

	function reorderReadingGroup(
		readings: ClassifiedReading[],
		groupParentId: string | null,
		readingId: string,
		targetIndex: number
	) {
		const siblings = readings
			.filter(reading => reading.parentReadingId === groupParentId)
			.sort((a, b) => a.order - b.order);
		const sourceIndex = siblings.findIndex(reading => reading.id === readingId);
		if (sourceIndex === -1) return readings;
		const clampedTargetIndex = Math.max(0, Math.min(targetIndex, siblings.length - 1));
		if (clampedTargetIndex === sourceIndex) return readings;
		const nextSiblings = [...siblings];
		const [moved] = nextSiblings.splice(sourceIndex, 1);
		if (!moved) return readings;
		nextSiblings.splice(clampedTargetIndex, 0, moved);
		const orderById = new Map(
			nextSiblings.map((reading, index) => [reading.id, index] as const)
		);
		return readings.map(reading =>
			reading.parentReadingId === groupParentId && orderById.has(reading.id)
				? { ...reading, order: orderById.get(reading.id) ?? reading.order }
				: reading
		);
	}

	function moveReadingByOffset(unitIndex: number, readingId: string, offset: number) {
		const readings = ensureReadingsForUnit(unitIndex);
		const reading = readings.find(entry => entry.id === readingId);
		if (!reading) return;
		const siblings = readings
			.filter(entry => entry.parentReadingId === reading.parentReadingId)
			.sort((a, b) => a.order - b.order);
		const currentIndex = siblings.findIndex(entry => entry.id === readingId);
		if (currentIndex === -1) return;
		const updated = reorderReadingGroup(
			readings,
			reading.parentReadingId,
			readingId,
			currentIndex + offset
		);
		setReadingsForUnit(unitIndex, updated);
	}

	function moveReadingBefore(unitIndex: number, readingId: string, targetReadingId: string) {
		const readings = ensureReadingsForUnit(unitIndex);
		const reading = readings.find(entry => entry.id === readingId);
		const target = readings.find(entry => entry.id === targetReadingId);
		if (!reading || !target) return;
		if (reading.parentReadingId !== target.parentReadingId) return;
		const siblings = readings
			.filter(entry => entry.parentReadingId === reading.parentReadingId)
			.sort((a, b) => a.order - b.order);
		const sourceIndex = siblings.findIndex(entry => entry.id === readingId);
		const targetIndex = siblings.findIndex(entry => entry.id === targetReadingId);
		if (sourceIndex === -1 || targetIndex === -1) return;
		const updated = reorderReadingGroup(
			readings,
			reading.parentReadingId,
			readingId,
			sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
		);
		setReadingsForUnit(unitIndex, updated);
	}

	function addStemmaEdge(unitIndex: number, edge: StemmaEdge) {
		const key = getReadingUnitKey(unitIndex);
		const existing = stemmaEdges.get(key) ?? [];
		const map = new Map(stemmaEdges);
		map.set(key, [...existing, edge]);
		stemmaEdges = map;
		markUnsaved();
	}

	function removeStemmaEdge(unitIndex: number, edgeId: string) {
		const key = getReadingUnitKey(unitIndex);
		const existing = stemmaEdges.get(key) ?? [];
		const map = new Map(stemmaEdges);
		map.set(
			key,
			existing.filter(e => e.id !== edgeId)
		);
		stemmaEdges = map;
		markUnsaved();
	}

	function suggestStemma(unitIndex: number) {
		const readings = getReadingsForUnit(unitIndex);
		if (readings.length < 2) return;

		// Heuristic: majority text = root, other readings derive from it
		const sorted = [...readings].sort((a, b) => b.witnessIds.length - a.witnessIds.length);
		const root = sorted[0];
		const edges: StemmaEdge[] = sorted.slice(1).map(r => ({
			id: crypto.randomUUID(),
			sourceReadingId: root.id,
			targetReadingId: r.id,
			directed: true,
		}));

		const map = new Map(stemmaEdges);
		map.set(getReadingUnitKey(unitIndex), edges);
		stemmaEdges = map;
		markUnsaved();
	}

	// Keyboard navigation
	function moveFocus(direction: 'up' | 'down' | 'left' | 'right') {
		if (phase === 'alignment' || phase === 'readings' || phase === 'stemma') {
			if (direction === 'left') focusedColumn = Math.max(0, focusedColumn - 1);
			if (direction === 'right')
				focusedColumn = Math.min(alignmentColumns.length - 1, focusedColumn + 1);
			if (direction === 'up') focusedRow = Math.max(0, focusedRow - 1);
			if (direction === 'down')
				focusedRow = Math.min(witnessOrder.length - 1, focusedRow + 1);

			if (phase === 'readings' || phase === 'stemma') {
				const spans = getVariationUnitSpans();
				if (spans.length === 0) {
					selectedUnitIndex = 0;
					return;
				}
				const currentPosition = spans.findIndex(
					span => span.startIndex === normalizeVariationUnitIndex(selectedUnitIndex)
				);
				if (direction === 'left' || direction === 'right') {
					const nextPosition =
						currentPosition === -1
							? 0
							: Math.max(
									0,
									Math.min(
										spans.length - 1,
										currentPosition + (direction === 'right' ? 1 : -1)
									)
								);
					selectedUnitIndex = spans[nextPosition]?.startIndex ?? selectedUnitIndex;
				} else {
					selectedUnitIndex = normalizeVariationUnitIndex(selectedUnitIndex);
				}
			}
		}
	}

	function reset() {
		phase = 'setup';
		furthestPhase = 'setup';
		saveStatus = 'saved';
		collationId = null;
		projectId = null;
		projectName = null;
		workspaceArtifactId = null;
		isLoading = false;
		selectedVerse = null;
		witnesses = [];
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
		rules = [];
		regularizedTexts = new Map();
		lowercase = false;
		ignoreWordBreaks = false;
		ignoreTokenWhitespace = true;
		ignorePunctuation = false;
		suppliedTextMode = 'clear';
		segmentation = true;
		transcriptionWitnessTreatments = new Map();
		alignmentColumns = [];
		witnessOrder = [];
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		alignmentDisplayMode = 'regularized';
		alignmentLayout = 'grid';
		selectedUnitIndex = 0;
		classifiedReadings = new Map();
		stemmaEdges = new Map();
		stemmaNodes = new Map();
		commandHistory = [];
		commandIndex = -1;
		if (saveTimeout) clearTimeout(saveTimeout);
	}

	async function createNewCollation(title: string, verseIdentifier: string): Promise<string> {
		if (!projectId) {
			throw new Error('A project must be selected before creating a collation.');
		}
		await ensureDjazzkitRuntime();
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		await Collation.objects.create({
			_djazzkit_id: id,
			_djazzkit_rev: 0,
			_djazzkit_deleted: false,
			_djazzkit_updated_at: now,
			title,
			verse_identifier: verseIdentifier,
			project_id: projectId,
			notes: '',
			group_path: '',
			sort_key: 0,
			status: 'setup',
			created_at: now,
			updated_at: now,
		});
		collationId = id;
		await persistDocument();
		return id;
	}

	async function loadCollationById(id: string): Promise<boolean> {
		isLoading = true;
		try {
			await ensureDjazzkitRuntime();
			const row = await Collation.objects
				.filter(f => f._djazzkit_id.eq(id))
				.filter(f => f._djazzkit_deleted.eq(false))
				.first();
			if (!row) {
				isLoading = false;
				return false;
			}
			if (!row.project_id) {
				throw new Error('Collation is missing its required project association.');
			}

			collationId = id;

			// Try to load the canonical collation document first.
			let artifact = await CollationArtifact.objects
				.filter(f => f.collation.eq(id))
				.filter(f => f.artifact_type.eq(COLLATION_DOCUMENT_ARTIFACT_TYPE))
				.filter(f => f._djazzkit_deleted.eq(false))
				.first();

			if (artifact && artifact.payload) {
				workspaceArtifactId = artifact._djazzkit_id;
				const raw =
					typeof artifact.payload === 'string'
						? artifact.payload
						: JSON.stringify(artifact.payload);
				applyCollationDocumentPayload(raw);
			} else {
				const legacyArtifact =
					(await CollationArtifact.objects
						.filter(f => f.collation.eq(id))
						.filter(f => f.artifact_type.eq(WORKSPACE_ARTIFACT_TYPE))
						.filter(f => f._djazzkit_deleted.eq(false))
						.first()) ??
					(await CollationArtifact.objects
						.filter(f => f.collation.eq(id))
						.filter(f => f.artifact_type.eq(LEGACY_WORKSPACE_ARTIFACT_TYPE))
						.filter(f => f._djazzkit_deleted.eq(false))
						.first());
				if (legacyArtifact?.payload) {
					const raw =
						typeof legacyArtifact.payload === 'string'
							? legacyArtifact.payload
							: JSON.stringify(legacyArtifact.payload);
					const snap = JSON.parse(raw) as WorkspaceSnapshot;
					applyLegacySnapshot(snap);
					workspaceArtifactId = null;
				} else if (row.status === 'complete') {
					await rebuildFromPersistedData(id, row);
				} else {
					throw new Error(
						'Collation document artifact missing for in-progress collation.'
					);
				}
			}
			await hydrateProjectContext(row.project_id);
			const repairedCollapsedAlignment = hasCollapsedAlignmentRegression();
			if (repairedCollapsedAlignment) {
				rebuildAlignmentFromWitnessTokens();
				saveStatus = 'unsaved';
				scheduleSave();
			}

			if (!repairedCollapsedAlignment) {
				saveStatus = 'saved';
			}
			void refreshChangedWitnessSourcesAfterLoad(id).catch(err => {
				console.error('Failed to refresh stale witness sources after load:', err);
			});
			isLoading = false;
			return true;
		} catch (err) {
			console.error('Failed to load collation:', err);
			isLoading = false;
			return false;
		}
	}

	async function rebuildFromPersistedData(id: string, collationRow: any): Promise<void> {
		const vi = collationRow.verse_identifier ?? '';
		selectedVerse = {
			identifier: vi,
			book: '',
			chapter: '',
			verse: '',
			count: 0,
		};
		const witnessRows = await CollationWitness.objects
			.filter(fields => fields.collation.eq(id))
			.filter(fields => fields._djazzkit_deleted.eq(false))
			.orderBy(fields => fields.position, 'asc')
			.all();
		const tokenRows = await CollationToken.objects
			.filter(fields => fields.collation.eq(id))
			.filter(fields => fields._djazzkit_deleted.eq(false))
			.orderBy(fields => fields.token_index, 'asc')
			.all();
		const tokensByWitnessId = new Map<string, typeof tokenRows>();
		for (const row of tokenRows) {
			const existing = tokensByWitnessId.get(row.witness_id) ?? [];
			existing.push(row);
			tokensByWitnessId.set(row.witness_id, existing);
		}
		witnesses = witnessRows.map((row, index) => ({
			witnessId: row.witness_id,
			siglum: row.witness_id,
			transcriptionId: row.transcription_id ?? '',
			sourceVersion: row.source_version,
			content: row.content,
			tokens: (tokensByWitnessId.get(row.witness_id) ?? [])
				.sort((a, b) => a.token_index - b.token_index)
				.map(token => ({
					kind: 'text' as const,
					original: token.token_text,
					segments: [
						{
							text: token.token_text,
							hasUnclear: false,
							isPunctuation: false,
							isSupplied: false,
						},
					],
					gap: null,
				})),
			treatment: 'inherit' as const,
			isBaseText: index === 0,
			isExcluded: false,
			overridesDefault: false,
		}));
		witnessOrder = witnessRows.map(row => row.witness_id);
		alignmentColumns = [];
		furthestPhase = 'setup';
		phase = 'setup';
	}

	return {
		get phase() {
			return phase;
		},
		get furthestPhase() {
			return furthestPhase;
		},
		get saveStatus() {
			return saveStatus;
		},
		get collationId() {
			return collationId;
		},
		get projectId() {
			return projectId;
		},
		get projectName() {
			return projectName;
		},
		get isLoading() {
			return isLoading;
		},
		get selectedVerse() {
			return selectedVerse;
		},
		set selectedVerse(v) {
			selectedVerse = v;
			markUnsaved();
		},
		get witnesses() {
			return witnesses;
		},
		get selectedBook() {
			return selectedBook;
		},
		set selectedBook(v) {
			selectedBook = v;
		},
		get selectedChapter() {
			return selectedChapter;
		},
		set selectedChapter(v) {
			selectedChapter = v;
		},
		get selectedVerseNum() {
			return selectedVerseNum;
		},
		set selectedVerseNum(v) {
			selectedVerseNum = v;
		},
		get rules() {
			return rules;
		},
		get regularizedTexts() {
			return regularizedTexts;
		},
		get lowercase() {
			return lowercase;
		},
		get ignoreWordBreaks() {
			return ignoreWordBreaks;
		},
		get ignoreTokenWhitespace() {
			return ignoreTokenWhitespace;
		},
		get ignorePunctuation() {
			return ignorePunctuation;
		},
		get suppliedTextMode() {
			return suppliedTextMode;
		},
		get segmentation() {
			return segmentation;
		},
		get transcriptionWitnessTreatments() {
			return transcriptionWitnessTreatments;
		},
		get transcriptionWitnessExcludedHands() {
			return transcriptionWitnessExcludedHands;
		},
		get alignmentColumns() {
			return alignmentColumns;
		},
		get alignmentDisplayMode() {
			return alignmentDisplayMode;
		},
		get alignmentLayout() {
			return alignmentLayout;
		},
		get witnessOrder() {
			return witnessOrder;
		},
		get selectedColumnIds() {
			return selectedColumnIds;
		},
		get selectedCells() {
			return selectedCells;
		},
		get focusedColumn() {
			return focusedColumn;
		},
		set focusedColumn(v) {
			focusedColumn = v;
		},
		get focusedRow() {
			return focusedRow;
		},
		set focusedRow(v) {
			focusedRow = v;
		},
		get selectedUnitIndex() {
			return selectedUnitIndex;
		},
		set selectedUnitIndex(v) {
			selectedUnitIndex = normalizeVariationUnitIndex(v);
		},
		get classifiedReadings() {
			return classifiedReadings;
		},
		get stemmaEdges() {
			return stemmaEdges;
		},
		get stemmaNodes() {
			return stemmaNodes;
		},
		canAdvance,
		canNavigateTo,
		setPhase,
		nextPhase,
		prevPhase,
		selectProject,
		clearProjectSelection,
		createProject,
		setWitnesses,
		updateWitness,
		setProjectTranscriptionTreatment,
		setAllProjectTranscriptionTreatments,
		getProjectTranscriptionTreatment,
		isProjectTranscriptionHandIncluded,
		setProjectTranscriptionHandIncluded,
		toggleWitnessExclusion,
		setBaseText,
		addRule,
		removeRule,
		toggleRule,
		setRuleType,
		setLowercase,
		setIgnoreWordBreaks,
		setIgnorePunctuation,
		setSuppliedTextMode,
		setSegmentation,
		applyRegularization,
		buildCollationWitnessInputs,
		refreshWitnessesFromSource,
		setAlignmentSnapshot,
		setAlignmentDisplayMode,
		setAlignmentLayout,
		mergeColumns,
		splitColumn,
		canSplitColumn,
		canShiftToken,
		shiftToken,
		toggleColumnSelection,
		clearColumnSelection,
		toggleCellSelection,
		selectCellRange,
		clearCellSelection,
		canMergeSelectedCells,
		mergeSelectedCells,
		getBaseWitnessId,
		getOrderedActiveWitnessIds,
		getWitnessTokensFromAlignment,
		getDisplayedColumnSlots,
		peekReadingsForUnit,
		getReadingFamiliesForUnit,
		getDisplayedWitnessIdsForReading,
		getReadingDisplayValuesForUnit,
		primeReadingsForUnit,
		getReadingsForUnit,
		getVariationUnitSpans,
		getVariationUnitSpan,
		getBaseTextForVariationUnit,
		classifyReading,
		splitWitnessFromReading,
		setReadingParent,
		promoteReadingAsFamilyParent,
		updateReadingText,
		updateReadingTextForDisplayMode,
		setReadingEditorType,
		addReading,
		deleteReading,
		moveWitnessToReading,
		moveReadingByOffset,
		moveReadingBefore,
		addStemmaEdge,
		removeStemmaEdge,
		suggestStemma,
		moveFocus,
		undo,
		redo,
		reset,
		createNewCollation,
		loadCollationById,
		pushCommand,
	};
}

export const collationState = createCollationState();
