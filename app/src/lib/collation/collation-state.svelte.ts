import {
	createCollation,
	createProject as createLocalProject,
	getCollationVersionStatus,
	getProject,
	getProjectTranscriptionIds,
	loadCollation,
	loadCommittedTranscriptionCheckpointPayload,
	listVerseIndexRowsForTranscriptions,
	saveCollationArtifact,
	updateProjectMetadata,
	updateCollationMetadata,
} from '$lib/db/client';
import { coerceTranscriptionDocument } from '$lib/transcription/content';
import {
	cloneAlignmentColumn,
	deserializeAlignmentColumns,
	witnessInputFromAlignment,
	type AlignmentCell,
	type AlignmentColumn,
	type AlignmentSnapshot,
} from './alignment-snapshot';
import {
	canMergeCells,
	canShiftToken as canShiftAlignmentToken,
	canSplitColumn as canSplitAlignmentColumn,
	cellSelectionKey,
	mergeCellsIn,
	mergeColumnsIn,
	shiftTokenIn,
	splitColumnIn,
	type AlignmentEditContext,
} from './alignment-edits';
import { collateToAlignmentSnapshot } from './collation-adapter';
import {
	applyWitnessTreatmentSource,
	buildWitnessConfigFromPrepared,
	buildWitnessSourceKey,
	cloneWitnessSourceTokens,
	didPreparedWitnessChangeSource,
	ensureBaseTextSelection,
} from './witness-config';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	buildCollationDocument,
	findBaseTextWitnessId,
	hydrateCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
	type CollationSegment,
} from './collation-document';
import {
	gatherWitnessesForSegment,
	prepareWitnessesFromDocument,
	type PreparedWitness,
} from './collation-runner';
import type {
	AlignmentDisplayMode,
	AlignmentLayout,
	ClassifiedReading,
	CollationPhase,
	RegularizationRule,
	RegularizationType,
	RegularizedToken,
	ReadingArc,
	SuppliedTextMode,
	WitnessConfig,
	WitnessTreatment,
} from './collation-types';
import {
	buildReadingProposal,
	getReadingFamilyKey,
	makeMainReadingIdOf,
	relabelReadings,
	type NonAttestation,
} from './collation-reading-proposal';
import {
	applyDecisions,
	cloneUnitDecisions,
	findOrphanedUnitDecisions,
	type OrphanedDecision,
	type UnitDecisions,
	type UnitView,
} from './collation-decisions';
import {
	resolveReadingTypeVocabulary,
	type Certainty,
	type ReadingTypeDefinition,
	type ReadingTypeId,
} from './reading-types';
import {
	buildDisplayedColumnSlots,
	buildSegmentSequence,
	type DisplayedColumnSlot,
	type Segment,
} from './collation-apparatus';
import {
	projectLocalStemma,
	wouldCreateCycle,
	type LocalStemma,
	type SourceDecision,
	type StemmaViolation,
} from './collation-stemma';
import { variationUnitId } from './collation-unit-id';
import {
	buildReadingFamilyGroups,
	buildVariationUnitSpans,
	readingText,
	type VariationUnitSpan,
} from './collation-variation-units';
import type { CollationWitnessInput } from './collation-worker-types';
import type { AggregatedVerse } from './gather-verses';
import {
	createProjectCollationSettings,
	mergeProjectRules,
	parseProjectCollationSettings,
} from './project-settings';
import {
	deriveCollationInput,
	validateRegularizationRule,
	type CollationInputDiagnostic,
	type DerivedCollationInput,
	type RegularizationRuleEffect,
} from './regularization';
import { isPunctuationToken, joinTokenTexts } from './token-text';
import {
	attestingWitnessIds,
	countLabel,
	emptyReading,
	mergeReadingsInto,
	moveReadingBeforeIn,
	moveReadingByOffsetIn,
	moveWitnesses,
	parentAttachmentError,
	promoteFamilyParent,
	redirectSubreadingAttachments,
	splitWitnesses,
	withNormalizedReadingText,
	withoutReading,
	withReadingText,
} from './reading-edits';

const PHASE_ORDER: CollationPhase[] = [
	'setup',
	'regularization',
	'alignment',
	'readings',
	'stemma',
	'review',
];
export type { CollationPhase, WitnessConfig, WitnessTreatment };

interface ReadingFamilyView {
	id: string;
	familyKey: string;
	parent: ClassifiedReading;
	children: ClassifiedReading[];
	members: ClassifiedReading[];
}

export type ReorderResult =
	{ ok: true } | { ok: false; error: 'reading-not-found' | 'different-group' | 'at-boundary' };

/** `movedWitnessIds` are exactly what changed, for announcements. */
type MoveWitnessesResult =
	| { ok: true; moved: number; movedWitnessIds: string[] }
	| { ok: false; error: 'reading-not-found' | 'no-attesting-witnesses' };

type SplitWitnessesResult =
	| { ok: true; readingId: string }
	| { ok: false; error: 'reading-not-found' | 'no-attesting-witnesses' | 'whole-reading' };

type MergeReadingsResult =
	| { ok: true }
	| { ok: false; error: 'reading-not-found' | 'nothing-to-merge' | 'target-under-source' };

interface ReadingDisplayValue {
	sourceOriginalText: string | null;
	sourceNormalizedText: string | null;
	originalDisplayText: string;
	regularizedDisplayText: string;
}

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

interface CommandEntry {
	type: string;
	undo: () => void;
	redo: () => void;
	description: string;
	phase: CollationPhase;
}

type PendingCommandEntry = Omit<CommandEntry, 'phase'>;

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

	let segment = $state<CollationSegment | null>(null);
	let orphanedMembers = $state<string[]>([]);
	let selectedVerse = $state<AggregatedVerse | null>(null);
	let witnesses = $state<WitnessConfig[]>([]);
	let selectedBook = $state('');
	let selectedChapter = $state('');
	let selectedVerseNum = $state('');

	let rules = $state<RegularizationRule[]>([]);
	let regularizedTexts = $state<Map<string, RegularizedToken[]>>(new Map());
	let regularizationDiagnostics = $state<CollationInputDiagnostic[]>([]);
	let regularizationRuleEffects = $state<RegularizationRuleEffect[]>([]);
	let derivedCollationInput: DerivedCollationInput | null = null;
	let lastAlignmentInputSignature = $state<string | null>(null);
	let lowercase = $state(false);
	let ignoreWordBreaks = $state(false);
	let ignoreTokenWhitespace = $state(true);
	let ignorePunctuation = $state(false);
	let suppliedTextMode = $state<SuppliedTextMode>('clear');
	let segmentation = $state(true);
	let transcriptionWitnessTreatments = $state<Map<string, WitnessTreatment>>(new Map());
	let transcriptionWitnessExcludedHands = $state<Map<string, string[]>>(new Map());
	let projectReadingTypes = $state<ReadingTypeDefinition[]>([]);

	let alignmentColumns = $state<AlignmentColumn[]>([]);
	let witnessOrder = $state<string[]>([]);
	let selectedColumnIds = $state<Set<string>>(new Set());
	let selectedCells = $state<Set<string>>(new Set());
	let focusedColumn = $state<number>(-1);
	let focusedRow = $state<number>(-1);
	let alignmentDisplayMode = $state<AlignmentDisplayMode>('regularized');
	let alignmentLayout = $state<AlignmentLayout>('grid');

	let selectedUnitIndex = $state<number>(0);
	let classifiedReadings = $state<Map<string, ClassifiedReading[]>>(new Map());
	let unitDecisions = $state<Map<string, UnitDecisions>>(new Map());
	let readingArcs = $state<Map<string, ReadingArc[]>>(new Map());

	let commandHistory = $state.raw<CommandEntry[]>([]);
	let commandIndex = $state(-1);

	function normalizeLegacyPhase(p: CollationPhase): CollationPhase {
		return p === 'regularization' ? 'alignment' : p;
	}

	function segmentMember(): string {
		return segment?.members[0] ?? '';
	}

	function applyCollationDocumentPayload(rawDocument: unknown) {
		const document = parseCollationDocument(rawDocument);
		if (!document) throw new Error('Invalid collation document artifact.');
		const hydrated = hydrateCollationDocument(document);
		phase = normalizeLegacyPhase(hydrated.phase);
		furthestPhase = normalizeLegacyPhase(hydrated.furthestPhase);
		segment = hydrated.segment;
		orphanedMembers = [];
		selectedVerse = null;
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
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
		unitDecisions = new Map(hydrated.unitDecisions);
		readingArcs = new Map(hydrated.readingArcs);
		alignmentDisplayMode = hydrated.alignmentDisplayMode;
		alignmentLayout = hydrated.alignmentLayout;
		regularizedTexts = new Map();
		regularizationDiagnostics = [];
		regularizationRuleEffects = [];
		derivedCollationInput = null;
		lastAlignmentInputSignature =
			alignmentColumns.length > 0 ? buildAlignmentInputSignature() : null;
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		commandHistory = [];
		commandIndex = -1;
	}

	function buildCollationDocumentPayload() {
		if (!segment) throw new Error('Collation segment is required.');
		return buildCollationDocument({
			collationId,
			projectId,
			projectName,
			phase,
			furthestPhase,
			segment,
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
			unitDecisions,
			readingArcs,
			alignmentDisplayMode,
			alignmentLayout,
		});
	}

	function isFinalizedCollationPhase(): boolean {
		return phase === 'review';
	}

	async function persistDocument(): Promise<boolean> {
		if (!collationId) return false;
		try {
			if (!segment) throw new Error('Collation segment is required.');
			const now = new Date().toISOString();
			const payload = serializeCollationDocument(buildCollationDocumentPayload());
			workspaceArtifactId = await saveCollationArtifact({
				artifactId: workspaceArtifactId,
				collationId,
				artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
				payload,
				now,
			});
			await updateCollationMetadata({
				id: collationId,
				verseIdentifier: segment.name,
				updatedAt: now,
				status: isFinalizedCollationPhase() ? 'complete' : phase,
			});
			return true;
		} catch (err) {
			console.error('Failed to persist collation document:', err);
			saveStatus = 'error';
			return false;
		}
	}

	function markUnsaved() {
		saveStatus = 'unsaved';
		scheduleSave();
	}

	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let inFlightSave: Promise<boolean> | null = null;

	async function runPersist(): Promise<boolean> {
		if (inFlightSave) return inFlightSave;
		saveStatus = 'saving';
		const promise = persistDocument();
		inFlightSave = promise;
		try {
			const ok = await promise;
			if (saveStatus === 'saving') {
				saveStatus = ok ? 'saved' : 'error';
			}
			return ok;
		} finally {
			if (inFlightSave === promise) {
				inFlightSave = null;
			}
		}
	}

	function scheduleSave() {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			saveTimeout = null;
			void runPersist();
		}, 800);
	}

	async function flushPendingSave(): Promise<boolean> {
		if (!collationId) return false;
		if (saveTimeout) {
			clearTimeout(saveTimeout);
			saveTimeout = null;
		}
		if (inFlightSave) {
			await inFlightSave;
		}
		if (saveStatus === 'unsaved' || saveStatus === 'error') {
			return runPersist();
		}
		return true;
	}

	function pushCommand(cmd: PendingCommandEntry) {
		commandHistory = [...commandHistory.slice(0, commandIndex + 1), { ...cmd, phase }].slice(
			-100
		);
		commandIndex = commandHistory.length - 1;
		markUnsaved();
	}

	function undo() {
		if (commandIndex < 0) return;
		const command = commandHistory[commandIndex];
		phase = command.phase;
		command.undo();
		commandIndex--;
		markUnsaved();
	}

	function redo() {
		if (commandIndex >= commandHistory.length - 1) return;
		commandIndex++;
		const command = commandHistory[commandIndex];
		phase = command.phase;
		command.redo();
		markUnsaved();
	}

	function setPhase(p: CollationPhase) {
		const normalized = normalizeLegacyPhase(p);
		phase = normalized;
		advanceFurthest(normalized);
		markUnsaved();
	}

	function advanceFurthest(p: CollationPhase) {
		if (PHASE_ORDER.indexOf(p) > PHASE_ORDER.indexOf(furthestPhase)) {
			furthestPhase = p;
		}
	}

	function canNavigateTo(targetPhase: CollationPhase): boolean {
		if (targetPhase === 'review') return alignmentColumns.length > 0;
		return PHASE_ORDER.indexOf(targetPhase) <= PHASE_ORDER.indexOf(furthestPhase);
	}

	function canAdvance(): boolean {
		if (phase === 'setup') {
			return (
				Boolean(segment?.name.trim()) &&
				Boolean(segment?.members.length) &&
				witnesses.some(w => !w.isExcluded)
			);
		}
		if (phase === 'regularization') return witnesses.some(w => !w.isExcluded);
		if (phase === 'alignment') return alignmentColumns.length > 0;
		if (phase === 'readings') return alignmentColumns.length > 0;
		if (phase === 'stemma') return alignmentColumns.length > 0;
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
		segment = null;
		orphanedMembers = [];
		selectedVerse = null;
		witnesses = [];
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
		regularizedTexts = new Map();
		regularizationDiagnostics = [];
		derivedCollationInput = null;
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
		return configs.filter(config => isWitnessIncludedByProjectSettings(config));
	}

	function applyWitnessTreatmentSources(configs: WitnessConfig[]): WitnessConfig[] {
		return configs.map(config =>
			applyWitnessTreatmentSource(config, transcriptionWitnessTreatments)
		);
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
		projectReadingTypes = [];
		if (!nextProjectId) {
			refreshCollationInput();
			return;
		}

		const project = await getProject(nextProjectId);
		if (!project) {
			projectId = null;
			refreshCollationInput();
			return;
		}

		projectName = project.name;
		const settings = parseProjectCollationSettings(project.collationSettings);
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
			Object.entries(settings.transcriptionWitnessExcludedHands ?? {}).map(
				([id, handIds]) => [id, [...handIds]]
			)
		);
		projectReadingTypes = settings.readingTypes ?? [];
		rules = mergeProjectRules(rules, settings.regularizationRules ?? []);
		if (
			previousIgnoreWordBreaks !== ignoreWordBreaks &&
			segmentMember() &&
			witnesses.length > 0
		) {
			const didChange = await refreshWitnessesFromTranscriptionSource();
			if (didChange) {
				handleWitnessSourceChange();
				saveStatus = 'unsaved';
				scheduleSave();
			}
		}
		refreshCollationInput();
	}

	function clearSelectedVerse() {
		selectedVerse = null;
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
	}

	async function restoreSelectedVerseFromProjectIndex(): Promise<void> {
		const member = segmentMember();
		if (!projectId || !member) {
			clearSelectedVerse();
			return;
		}

		const transcriptionIds = await getProjectTranscriptionIds(projectId);
		const rows = await listVerseIndexRowsForTranscriptions(transcriptionIds);
		const matchingRows = rows.filter(row => row.verse_identifier === member);
		const row = matchingRows[0];
		if (!row) {
			clearSelectedVerse();
			return;
		}

		selectedVerse = {
			identifier: row.verse_identifier,
			book: row.book,
			chapter: row.chapter,
			verse: row.verse,
			count: matchingRows.length,
		};
		selectedBook = row.book;
		selectedChapter = row.chapter;
		selectedVerseNum = row.verse;
	}

	async function refreshOrphanedMembersFromProjectIndex(): Promise<void> {
		const expectedCollationId = collationId;
		const expectedProjectId = projectId;
		const expectedSegment = segment;
		if (!expectedProjectId || !expectedSegment?.members.length) {
			orphanedMembers = [];
			return;
		}

		const transcriptionIds = await getProjectTranscriptionIds(expectedProjectId);
		const gathered = await gatherWitnessesForSegment(
			{ members: [...expectedSegment.members] },
			transcriptionIds,
			{ ignoreWordBreaks }
		);
		if (
			collationId !== expectedCollationId ||
			projectId !== expectedProjectId ||
			segment !== expectedSegment
		) {
			return;
		}
		orphanedMembers = [...(gathered.orphanedMembers ?? [])];
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
		const now = new Date().toISOString();
		const id = await createLocalProject({
			id: crypto.randomUUID(),
			name,
			description: '',
			charter: '',
			collationSettings: createProjectCollationSettings([], {
				ignoreWordBreaks: false,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments,
				transcriptionWitnessExcludedHands,
				readingTypes: projectReadingTypes,
			}),
			createdAt: now,
			updatedAt: now,
		});
		await selectProject(id);
		return id;
	}

	function setWitnesses(configs: WitnessConfig[]) {
		witnesses = ensureBaseTextSelection(
			applyWitnessTreatmentSources(filterWitnessesByProjectSettings(configs))
		);
		refreshCollationInput();
		markUnsaved();
	}

	function updateWitness(witnessId: string, updates: Partial<WitnessConfig>) {
		witnesses = applyWitnessTreatmentSources(
			witnesses.map(w => {
				if (w.witnessId !== witnessId) return w;
				const next = { ...w, ...updates };
				if (Object.prototype.hasOwnProperty.call(updates, 'treatment')) {
					next.overridesDefault = next.treatment !== 'inherit';
				}
				return next;
			})
		);
		refreshCollationInput();
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

	async function persistRulesToProject(nextRules: RegularizationRule[]): Promise<void> {
		if (!projectId) return;
		try {
			await updateProjectMetadata({
				projectId,
				collationSettings: createProjectCollationSettings(nextRules, {
					ignoreWordBreaks,
					lowercase,
					ignoreTokenWhitespace,
					ignorePunctuation,
					suppliedTextMode,
					segmentation,
					transcriptionWitnessTreatments,
					transcriptionWitnessExcludedHands,
					readingTypes: projectReadingTypes,
				}),
				updatedAt: new Date().toISOString(),
			});
		} catch (err) {
			console.error('Failed to persist project collation settings:', err);
		}
	}

	function setRules(nextRules: RegularizationRule[]) {
		rules = nextRules;
		refreshCollationInput();
		void persistRulesToProject(nextRules);
		markUnsaved();
	}

	function getRuleValidationError(ruleId: string): string | null {
		const rule = rules.find(item => item.id === ruleId);
		return rule ? validateRegularizationRule(rule) : null;
	}

	function validateRegularizationPattern(pattern: string): string | null {
		return validateRegularizationRule({
			id: '__draft__',
			pattern,
			replacement: '',
			scope: 'verse',
			description: '',
			enabled: true,
			type: 'none',
		});
	}

	function getRuleEffects(ruleId?: string): RegularizationRuleEffect[] {
		return ruleId
			? regularizationRuleEffects.filter(effect => effect.ruleId === ruleId)
			: regularizationRuleEffects;
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
		refreshCollationInput();
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
		refreshCollationInput();
		markUnsaved();
	}

	function setIgnorePunctuation(nextValue: boolean) {
		ignorePunctuation = nextValue;
		void persistRulesToProject(rules);
		refreshCollationInput();
		markUnsaved();
	}

	function setSuppliedTextMode(nextValue: SuppliedTextMode) {
		suppliedTextMode = nextValue;
		void persistRulesToProject(rules);
		refreshCollationInput();
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
		refreshCollationInput();
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
		refreshCollationInput();
		void persistRulesToProject(rules);
		markUnsaved();
	}

	function isProjectTranscriptionHandIncluded(transcriptionId: string, handId: string): boolean {
		return isWitnessIncludedByProjectSettings({ transcriptionId, handId });
	}

	function setProjectTranscriptionHandIncluded(
		transcriptionId: string,
		handId: string,
		included: boolean
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
		if (segmentMember()) {
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

	function refreshCollationInput() {
		derivedCollationInput = deriveCollationInput(
			witnesses,
			{ lowercase, ignoreTokenWhitespace, ignorePunctuation, suppliedTextMode },
			rules
		);
		regularizedTexts = derivedCollationInput.perWitnessTokens;
		regularizationDiagnostics = derivedCollationInput.diagnostics;
		regularizationRuleEffects = derivedCollationInput.ruleEffects;
	}

	function buildAlignmentInputSignature(): string {
		const input = getDerivedCollationInput();
		return JSON.stringify({
			settings: {
				lowercase,
				ignoreTokenWhitespace,
				ignorePunctuation,
				suppliedTextMode,
				segmentation,
			},
			rules: rules.map(rule => ({
				id: rule.id,
				pattern: rule.pattern,
				replacement: rule.replacement,
				scope: rule.scope,
				enabled: rule.enabled,
				type: rule.type,
			})),
			witnessInputs: input.witnessInputs,
		});
	}

	function isAlignmentStale(): boolean {
		if (alignmentColumns.length === 0 || !lastAlignmentInputSignature) return false;
		return buildAlignmentInputSignature() !== lastAlignmentInputSignature;
	}

	function getDerivedCollationInput(): DerivedCollationInput {
		if (!derivedCollationInput) refreshCollationInput();
		return derivedCollationInput!;
	}

	function alignmentEditContext(): AlignmentEditContext {
		return {
			rules,
			witnessOrder,
			witnessIds: witnesses.map(witness => witness.witnessId),
			baseWitnessId: getBaseWitnessId(),
		};
	}

	function setColumnsWithUndo(next: AlignmentColumn[], type: string, description: string) {
		const previous = alignmentColumns.map(cloneAlignmentColumn);
		alignmentColumns = next;
		pushCommand({
			type,
			description,
			undo: () => {
				alignmentColumns = previous.map(cloneAlignmentColumn);
			},
			redo: () => {
				alignmentColumns = next.map(cloneAlignmentColumn);
			},
		});
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
			witnesses: buildCollationWitnessInputs({ forceSourceWitnesses: true }),
			options: { segmentation },
		});
		applyAlignmentSnapshot(snapshot.snapshot);
	}

	async function refreshWitnessesFromTranscriptionSource(
		transcriptionIds?: string[],
		options?: { expectedCollationId?: string }
	): Promise<boolean> {
		const member = segmentMember();
		if (!member) return false;
		const scopedTranscriptionIds =
			transcriptionIds ??
			witnesses
				.map(witness => witness.transcriptionId)
				.filter((id): id is string => typeof id === 'string' && id.length > 0);
		if (scopedTranscriptionIds.length === 0 && transcriptionIds === undefined) return false;

		const gathered = await gatherWitnessesForSegment(
			{ members: [...segment!.members] },
			scopedTranscriptionIds,
			{ ignoreWordBreaks }
		);
		if (options?.expectedCollationId && collationId !== options.expectedCollationId)
			return false;
		if (gathered.error) return false;
		const preparedWitnesses = gathered.witnesses;
		const scopedIds = new Set(scopedTranscriptionIds);
		const preparedByKey = new Map(
			preparedWitnesses.map(
				witness =>
					[
						buildWitnessSourceKey({
							transcriptionId: witness.transcriptionUid,
							kind: witness.kind,
							handId: witness.handId,
						}),
						witness,
					] as const
			)
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
				applyWitnessTreatmentSource(
					{
						...witness,
						siglum: prepared.siglum,
						kind: prepared.kind,
						handId: prepared.handId,
						sourceVersion: prepared.sourceVersion,
						fullContent: prepared.fullContent ?? prepared.content,
						fullTokens: cloneWitnessSourceTokens(
							prepared.fullTokens ?? prepared.tokens
						),
						fragmentaryContent: prepared.fragmentaryContent,
						fragmentaryTokens: cloneWitnessSourceTokens(
							prepared.fragmentaryTokens ?? []
						),
						content: prepared.content,
						tokens: cloneWitnessSourceTokens(prepared.tokens),
					},
					transcriptionWitnessTreatments
				)
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
			nextWitnesses.push(
				buildWitnessConfigFromPrepared(prepared, transcriptionWitnessTreatments)
			);
		}
		witnesses = ensureBaseTextSelection(applyWitnessTreatmentSources(nextWitnesses));
		await refreshOrphanedMembersFromProjectIndex();
		return didChange;
	}

	async function refreshWitnessesFromSource(transcriptionIds?: string[]): Promise<boolean> {
		const didChange = await refreshWitnessesFromTranscriptionSource(transcriptionIds);
		if (!didChange) return false;
		handleWitnessSourceChange();
		saveStatus = 'unsaved';
		scheduleSave();
		return true;
	}

	async function applyCheckpointToWitness(
		witnessId: string,
		checkpointId: string
	): Promise<boolean> {
		const expectedCollationId = collationId;
		const expectedSegmentId = segment?.id;
		const expectedMembers = segment ? [...segment.members] : [];
		if (!expectedCollationId || !expectedSegmentId || expectedMembers.length === 0)
			return false;
		const witness = witnesses.find(w => w.witnessId === witnessId);
		if (!witness || !witness.transcriptionId) return false;
		const expectedTranscriptionId = witness.transcriptionId;

		const loaded = await loadCommittedTranscriptionCheckpointPayload(
			expectedTranscriptionId,
			checkpointId
		);
		const currentSegment = segment;
		if (
			collationId !== expectedCollationId ||
			!currentSegment ||
			currentSegment.id !== expectedSegmentId ||
			currentSegment.members.length !== expectedMembers.length ||
			currentSegment.members.some((member, index) => member !== expectedMembers[index])
		) {
			return false;
		}
		const currentWitness = witnesses.find(w => w.witnessId === witnessId);
		if (!currentWitness || currentWitness.transcriptionId !== expectedTranscriptionId) {
			return false;
		}
		const document = coerceTranscriptionDocument(loaded.payload.content_json);
		if (!document) return false;

		const preparedWitnesses: PreparedWitness[] = [];
		const memberByTranscription = new Map<string, string>();
		for (const member of new Set(expectedMembers)) {
			const preparedForMember = prepareWitnessesFromDocument({
				document,
				verseIdentifier: member,
				transcriptionId: expectedTranscriptionId,
				siglum: loaded.payload.siglum || currentWitness.siglum,
				sourceVersion: loaded.id,
				options: { ignoreWordBreaks },
			});
			for (const prepared of preparedForMember) {
				const previousMember = memberByTranscription.get(prepared.transcriptionUid);
				if (previousMember !== undefined && previousMember !== member) return false;
				memberByTranscription.set(prepared.transcriptionUid, member);
				preparedWitnesses.push(prepared);
			}
		}

		const witnessKind = currentWitness.kind ?? 'firsthand';
		const witnessHandId = currentWitness.handId ?? 'firsthand';
		const matching = preparedWitnesses.find(
			prepared =>
				(prepared.kind ?? 'firsthand') === witnessKind &&
				(prepared.handId ?? 'firsthand') === witnessHandId
		);
		if (!matching) return false;

		const updated = applyWitnessTreatmentSource(
			{
				...currentWitness,
				siglum: matching.siglum,
				sourceVersion: matching.sourceVersion,
				sourceContentHash: loaded.contentHash,
				content: matching.content,
				tokens: cloneWitnessSourceTokens(matching.tokens),
				fullContent: matching.fullContent,
				fullTokens: cloneWitnessSourceTokens(matching.fullTokens ?? matching.tokens),
				fragmentaryContent: matching.fragmentaryContent,
				fragmentaryTokens: cloneWitnessSourceTokens(matching.fragmentaryTokens ?? []),
			},
			transcriptionWitnessTreatments
		);
		witnesses = applyWitnessTreatmentSources(
			witnesses.map(w => (w.witnessId === witnessId ? updated : w))
		);
		return true;
	}

	async function refreshWitnessSource(
		witnessId: string,
		sourceCheckpointId?: string
	): Promise<boolean> {
		if (!collationId) return false;
		let checkpointId = sourceCheckpointId ?? null;
		if (!checkpointId) {
			const status = await getCollationVersionStatus(collationId);
			const witnessStatus = status.witnesses.find(entry => entry.witnessId === witnessId);
			if (!witnessStatus?.availableCheckpoint) return false;
			checkpointId = witnessStatus.availableCheckpoint.revisionId;
		}

		const didRefresh = await applyCheckpointToWitness(witnessId, checkpointId);
		if (!didRefresh) return false;

		handleWitnessSourceChange();
		markUnsaved();
		return true;
	}

	async function refreshAllStaleWitnessSources(): Promise<number> {
		if (!collationId) return 0;
		const status = await getCollationVersionStatus(collationId);
		const staleWitnesses = status.witnesses.filter(
			witness =>
				witness.versionState === 'newer-source-available' && witness.availableCheckpoint
		);
		let refreshedCount = 0;
		for (const witness of staleWitnesses) {
			const checkpointId = witness.availableCheckpoint?.revisionId;
			if (!checkpointId) continue;
			if (await applyCheckpointToWitness(witness.witnessId, checkpointId)) {
				refreshedCount++;
			}
		}
		if (refreshedCount === 0) return 0;
		handleWitnessSourceChange();
		markUnsaved();
		return refreshedCount;
	}

	function handleWitnessSourceChange() {
		refreshCollationInput();
		if (alignmentColumns.length > 0) {
			rebuildAlignmentFromWitnessTokens();
		}
		classifiedReadings = new Map();
		readingArcs = new Map();
		selectedUnitIndex = 0;
		if (furthestPhase === 'stemma' || furthestPhase === 'review') {
			furthestPhase = 'alignment';
		}
		if (phase === 'stemma' || phase === 'review') {
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
			return orderedIds.map(witnessId =>
				witnessInputFromAlignment(alignmentColumns, witnessId, ignorePunctuation)
			);
		}
		const inputByWitnessId = new Map(
			getDerivedCollationInput().witnessInputs.map(input => [input.id, input] as const)
		);
		return orderedIds
			.map(witnessId => inputByWitnessId.get(witnessId))
			.filter((input): input is CollationWitnessInput => Boolean(input));
	}

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
		lastAlignmentInputSignature = buildAlignmentInputSignature();
		selectedUnitIndex = normalizeVariationUnitIndex(selectedUnitIndex);
		advanceFurthest('alignment');
		classifiedReadings = new Map();
		readingArcs = new Map();
		markUnsaved();
	}

	function mergeColumns(columnIds: string[]) {
		if (columnIds.length < 2) return;
		const next = mergeColumnsIn(alignmentColumns, columnIds, alignmentEditContext());
		setColumnsWithUndo(next, 'merge-columns', `Merge ${columnIds.length} units`);
		selectedColumnIds = new Set();
	}

	function toggleCellSelection(columnId: string, witnessId: string) {
		const key = cellSelectionKey(witnessId, columnId);
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
			next.add(cellSelectionKey(witnessId, alignmentColumns[i].id));
		}
		selectedCells = next;
	}

	function clearCellSelection() {
		selectedCells = new Set();
	}

	function canMergeSelectedCells(): boolean {
		return canMergeCells(alignmentColumns, selectedCells);
	}

	function mergeSelectedCells() {
		const merged = mergeCellsIn(alignmentColumns, selectedCells, rules);
		if (!merged) return;
		setColumnsWithUndo(
			merged.columns,
			'merge-cells',
			`Merge ${merged.count} adjacent cells for ${merged.witnessId}`
		);
		selectedCells = new Set();
	}

	function splitColumn(columnId: string) {
		const next = splitColumnIn(alignmentColumns, columnId, alignmentEditContext());
		if (next) setColumnsWithUndo(next, 'split-column', 'Split alignment unit');
	}

	function canSplitColumn(columnId: string): boolean {
		return canSplitAlignmentColumn(alignmentColumns, columnId);
	}

	function getDisplayedColumnSlots(
		columns: AlignmentColumn[] = alignmentColumns
	): DisplayedColumnSlot[] {
		return buildDisplayedColumnSlots(columns, getBaseWitnessId());
	}

	function canShiftToken(
		columnId: string,
		witnessId: string,
		direction: 'left' | 'right'
	): boolean {
		return canShiftAlignmentToken(
			alignmentColumns,
			columnId,
			witnessId,
			direction,
			alignmentEditContext()
		);
	}

	function shiftToken(columnId: string, witnessId: string, direction: 'left' | 'right') {
		const next = shiftTokenIn(
			alignmentColumns,
			columnId,
			witnessId,
			direction,
			alignmentEditContext()
		);
		if (next) setColumnsWithUndo(next, 'shift-token', `Shift token ${direction}`);
	}

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

	/** Designated base text; never falls back. */
	function getBaseTextWitnessId(): string | null {
		return findBaseTextWitnessId(witnesses);
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

	function getVariationUnitSpans() {
		return buildVariationUnitSpans(alignmentColumns);
	}

	/** Single verse-shape derivation; all surfaces read here. */
	function getSegmentSequence(): Segment[] {
		return buildSegmentSequence({
			columns: alignmentColumns,
			spans: getVariationUnitSpans(),
			baseWitnessId: getBaseWitnessId(),
		});
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

	function getReadingUnitKey(unitIndex: number): string | null {
		const columnId = getVariationUnitSpan(unitIndex)?.columnIds[0];
		return columnId ? variationUnitId(columnId) : null;
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

	function buildProposalForUnit(unitIndex: number) {
		const span = getVariationUnitSpan(unitIndex);
		if (!span) return null;
		const columns = getColumnsForUnit(span.startIndex);
		return buildReadingProposal({
			columns,
			spanColumnIds: span.columnIds,
			sourceWitnessIds: getSourceWitnessIdsForColumns(columns),
			baseWitnessId: getBaseTextWitnessId(),
		});
	}

	function buildReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		return buildProposalForUnit(unitIndex)?.readings ?? [];
	}

	/**
	 * The witnesses absent from a unit. Derived from the alignment on every read rather than
	 * stored, because absence is a fact about the witnesses, never an editorial decision.
	 */
	function getNonAttestationForUnit(unitIndex: number): NonAttestation {
		return (
			buildProposalForUnit(unitIndex)?.nonAttestation ?? {
				witnessIds: [],
				untranscribedWitnessIds: [],
			}
		);
	}

	const EMPTY_UNIT_VIEW: UnitView = {
		readings: [],
		orphanedDecisions: [],
		lemmaReadingId: null,
		baseTextReadingId: null,
		needsLemmaDecision: false,
	};

	function viewUnit(key: string, proposal: ClassifiedReading[]): UnitView {
		return applyDecisions(proposal, unitDecisions.get(key) ?? {}, {
			baseWitnessId: getBaseTextWitnessId(),
		});
	}

	function ensureReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return [];
		const existing = classifiedReadings.get(key);
		if (existing) return viewUnit(key, existing).readings;
		const built = buildReadingsForUnit(unitIndex);
		classifiedReadings = new Map(classifiedReadings).set(key, built);
		return viewUnit(key, built).readings;
	}

	function peekUnitView(unitIndex: number): UnitView {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return EMPTY_UNIT_VIEW;
		return viewUnit(key, classifiedReadings.get(key) ?? buildReadingsForUnit(unitIndex));
	}

	function peekReadingsForUnit(unitIndex: number): ClassifiedReading[] {
		return peekUnitView(unitIndex).readings;
	}

	function getOrphanedDecisionsForUnit(unitIndex: number): OrphanedDecision[] {
		// Only the projection knows if an arc still names live readings.
		const arcOrphans: OrphanedDecision[] = getLocalStemma(unitIndex).orphanedArcs.map(
			orphan => ({
				kind: 'sourceArc',
				readingId: orphan.arc.posteriorReadingId,
				priorReadingId: orphan.arc.priorReadingId,
				missingReadingIds: orphan.missingReadingIds,
			})
		);
		return [...peekUnitView(unitIndex).orphanedDecisions, ...arcOrphans];
	}

	function getOrphanedUnitDecisions() {
		const liveUnitIds = new Set(
			getVariationUnitSpans().map(span => variationUnitId(span.columnIds[0]))
		);
		return findOrphanedUnitDecisions(unitDecisions, liveUnitIds, readingArcs);
	}

	function getReadingFamiliesForUnit(unitIndex: number): ReadingFamilyView[] {
		// Already lemma-first; re-sorting would discard the lemma.
		const readings = peekReadingsForUnit(unitIndex);
		// Families are whole chains, not direct children.
		const mainReadingIdOf = makeMainReadingIdOf(readings);
		const primaries = readings.filter(reading => reading.parentReadingId === null);
		return primaries.map(parent => {
			const children = readings.filter(
				reading =>
					reading.parentReadingId !== null && mainReadingIdOf(reading.id) === parent.id
			);
			return {
				id: parent.id,
				familyKey: getReadingFamilyKey(parent),
				parent,
				children,
				members: [parent, ...children],
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

		const family = getReadingFamiliesForUnit(unitIndex).find(
			entry => entry.parent.id === readingId
		);
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
			baseWitnessId: getBaseTextWitnessId(),
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
		if (!key) return;
		const proposalById = new Map(
			(classifiedReadings.get(key) ?? []).map(reading => [reading.id, reading] as const)
		);
		// Restore overlayable fields from proposal, or decided values survive undo.
		const decisions = unitDecisions.get(key) ?? {};
		const attachments = decisions.subreadingOf ?? {};
		const readingTypes = decisions.readingType ?? {};
		const certainties = decisions.certainty ?? {};
		const proposal = readings.map(reading => {
			const existing = proposalById.get(reading.id);
			if (!existing) return reading;
			let restored = reading;
			if (Object.hasOwn(attachments, reading.id)) {
				restored = {
					...restored,
					parentReadingId: existing.parentReadingId,
					isSubreading: existing.isSubreading,
					autoGenerated: existing.autoGenerated,
				};
			}
			if (Object.hasOwn(readingTypes, reading.id)) {
				restored = { ...restored, readingType: existing.readingType };
			}
			if (Object.hasOwn(certainties, reading.id)) {
				restored = { ...restored, certainty: existing.certainty };
			}
			return restored;
		});
		classifiedReadings = new Map(classifiedReadings).set(
			key,
			relabelReadings(proposal, getBaseTextWitnessId())
		);
		markUnsaved();
	}

	function restoreUnitState(
		key: string,
		readings: ClassifiedReading[] | undefined,
		decisions: UnitDecisions | undefined
	) {
		const nextReadings = new Map(classifiedReadings);
		if (readings) nextReadings.set(key, readings);
		else nextReadings.delete(key);
		classifiedReadings = nextReadings;
		const nextDecisions = new Map(unitDecisions);
		if (decisions) nextDecisions.set(key, decisions);
		else nextDecisions.delete(key);
		unitDecisions = nextDecisions;
	}

	/** One gesture, one unit, one undo entry; merge carries its attachment. */
	function commitReadingsForUnit(
		unitIndex: number,
		readings: ClassifiedReading[],
		command: { type: string; description: string },
		decisions?: UnitDecisions
	) {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return;
		const previousReadings = classifiedReadings.get(key);
		const previousDecisions = unitDecisions.get(key);
		setReadingsForUnit(unitIndex, readings);
		if (decisions) unitDecisions = new Map(unitDecisions).set(key, decisions);
		const updatedReadings = classifiedReadings.get(key);
		const updatedDecisions = unitDecisions.get(key);
		pushCommand({
			...command,
			undo: () => restoreUnitState(key, previousReadings, previousDecisions),
			redo: () => restoreUnitState(key, updatedReadings, updatedDecisions),
		});
	}

	function moveWitnessesToReading(
		unitIndex: number,
		witnessIds: string[],
		targetReadingId: string
	): MoveWitnessesResult {
		const edit = moveWitnesses(ensureReadingsForUnit(unitIndex), witnessIds, targetReadingId);
		if (!edit.ok) return edit;
		if (edit.moving.length > 0) {
			commitReadingsForUnit(unitIndex, edit.readings, {
				type: 'move-witnesses-to-reading',
				description: `Move ${countLabel(edit.moving.length, 'witness')} to a reading`,
			});
		}
		return { ok: true, moved: edit.moving.length, movedWitnessIds: edit.moving };
	}

	function splitWitnessesIntoNewReading(
		unitIndex: number,
		witnessIds: string[],
		options?: { subreadingOf?: string }
	): SplitWitnessesResult {
		const edit = splitWitnesses(
			ensureReadingsForUnit(unitIndex),
			witnessIds,
			options?.subreadingOf ?? null
		);
		if (!edit.ok) return edit;
		commitReadingsForUnit(unitIndex, edit.readings, {
			type: 'split-witnesses-into-reading',
			description: `Split ${countLabel(edit.selected.length, 'witness')} into a new reading`,
		});
		return { ok: true, readingId: edit.readingId };
	}

	function mergeReadings(
		unitIndex: number,
		sourceReadingIds: string[],
		targetReadingId: string
	): MergeReadingsResult {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'reading-not-found' };
		const edit = mergeReadingsInto(
			ensureReadingsForUnit(unitIndex),
			sourceReadingIds,
			targetReadingId
		);
		if (!edit.ok) return edit;
		commitReadingsForUnit(
			unitIndex,
			edit.readings,
			{
				type: 'merge-readings',
				description: `Merge ${edit.sourceIds.size + 1} readings`,
			},
			redirectSubreadingAttachments(unitDecisions.get(key), edit.sourceIds, targetReadingId)
		);
		return { ok: true };
	}

	function setReadingParent(
		unitIndex: number,
		readingId: string,
		parentReadingId: string | null
	): { ok: true } | { ok: false; error: 'reading-not-found' | 'self-attachment' | 'cycle' } {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'reading-not-found' };
		const error = parentAttachmentError(
			ensureReadingsForUnit(unitIndex),
			readingId,
			parentReadingId
		);
		if (error) return { ok: false, error };

		const previous = new Map(unitDecisions);
		const next = cloneUnitDecisions(previous.get(key));
		next.subreadingOf = { ...next.subreadingOf, [readingId]: parentReadingId };
		const updated = new Map(previous).set(key, next);
		unitDecisions = updated;
		pushCommand({
			type: 'set-subreading-attachment',
			description: parentReadingId ? 'Attach subreading' : 'Detach subreading',
			undo: () => {
				unitDecisions = new Map(previous);
			},
			redo: () => {
				unitDecisions = new Map(updated);
			},
		});
		return { ok: true };
	}

	function getLemmaReadingId(unitIndex: number): string | null {
		return peekUnitView(unitIndex).lemmaReadingId;
	}

	function unitNeedsLemmaDecision(unitIndex: number): boolean {
		return peekUnitView(unitIndex).needsLemmaDecision;
	}

	/** Labelling only; null restores the base-text lemma, stemma untouched. */
	function setLemmaReading(
		unitIndex: number,
		readingId: string | null
	): { ok: true } | { ok: false; error: 'reading-not-found' | 'not-a-main-reading' } {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'reading-not-found' };
		const readings = ensureReadingsForUnit(unitIndex);
		if (readingId !== null) {
			const target = readings.find(reading => reading.id === readingId);
			if (!target) return { ok: false, error: 'reading-not-found' };
			if (target.parentReadingId !== null) return { ok: false, error: 'not-a-main-reading' };
		}

		const previous = new Map(unitDecisions);
		const next = cloneUnitDecisions(previous.get(key));
		if ((next.lemmaReadingId ?? null) === readingId) return { ok: true };
		next.lemmaReadingId = readingId;
		const updated = new Map(previous).set(key, next);
		unitDecisions = updated;
		pushCommand({
			type: 'set-lemma-reading',
			description: readingId ? 'Establish lemma reading' : 'Clear lemma reading',
			undo: () => {
				unitDecisions = new Map(previous);
			},
			redo: () => {
				unitDecisions = new Map(updated);
			},
		});
		return { ok: true };
	}

	function forEachUnitView<T>(map: (view: UnitView, span: VariationUnitSpan) => T | null): T[] {
		const results: T[] = [];
		for (const span of getVariationUnitSpans()) {
			const mapped = map(peekUnitView(span.startIndex), span);
			if (mapped !== null) results.push(mapped);
		}
		return results;
	}

	/** Units with no lemma yet. */
	function getUnitsNeedingLemmaDecision(): { unitIndex: number; unitId: string }[] {
		return forEachUnitView((view, span) =>
			view.needsLemmaDecision
				? { unitIndex: span.startIndex, unitId: variationUnitId(span.columnIds[0]) }
				: null
		);
	}

	/** Where lemma departs from base-text reading. */
	function getLemmaDivergence(): {
		unitIndex: number;
		unitId: string;
		lemmaReadingId: string;
		baseTextReadingId: string;
	}[] {
		return forEachUnitView((view, span) =>
			view.lemmaReadingId &&
			view.baseTextReadingId &&
			view.lemmaReadingId !== view.baseTextReadingId
				? {
						unitIndex: span.startIndex,
						unitId: variationUnitId(span.columnIds[0]),
						lemmaReadingId: view.lemmaReadingId,
						baseTextReadingId: view.baseTextReadingId,
					}
				: null
		);
	}

	function promoteReadingAsFamilyParent(unitIndex: number, readingId: string) {
		const updated = promoteFamilyParent(ensureReadingsForUnit(unitIndex), readingId);
		if (!updated) return;
		commitReadingsForUnit(unitIndex, updated, {
			type: 'promote-reading-as-family-parent',
			description: 'Promote reading to main reading',
		});
	}

	function updateReadingText(unitIndex: number, readingId: string, text: string) {
		commitReadingsForUnit(
			unitIndex,
			withReadingText(ensureReadingsForUnit(unitIndex), readingId, text),
			{ type: 'update-reading-text', description: 'Edit reading text' }
		);
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
		commitReadingsForUnit(
			unitIndex,
			withNormalizedReadingText(ensureReadingsForUnit(unitIndex), readingId, text),
			{ type: 'update-reading-text', description: 'Edit reading text' }
		);
	}

	/** Judgement only, never touches text; null means "no type". */
	function setReadingType(
		unitIndex: number,
		readingId: string,
		readingType: ReadingTypeId | null
	): { ok: true } | { ok: false; error: 'reading-not-found' } {
		return recordReadingDecision(unitIndex, readingId, 'readingType', readingType, {
			type: 'set-reading-type',
			description: readingType ? 'Set reading type' : 'Clear reading type',
		});
	}

	/** Scholar confidence, orthogonal to type. */
	function setReadingCertainty(
		unitIndex: number,
		readingId: string,
		certainty: Certainty | null
	): { ok: true } | { ok: false; error: 'reading-not-found' } {
		return recordReadingDecision(unitIndex, readingId, 'certainty', certainty, {
			type: 'set-reading-certainty',
			description: certainty === null ? 'Clear reading certainty' : 'Set reading certainty',
		});
	}

	function recordReadingDecision<Field extends 'readingType' | 'certainty'>(
		unitIndex: number,
		readingId: string,
		field: Field,
		value: NonNullable<UnitDecisions[Field]>[string],
		command: { type: string; description: string }
	): { ok: true } | { ok: false; error: 'reading-not-found' } {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'reading-not-found' };
		const readings = ensureReadingsForUnit(unitIndex);
		if (!readings.some(reading => reading.id === readingId)) {
			return { ok: false, error: 'reading-not-found' };
		}

		const previous = new Map(unitDecisions);
		const next = cloneUnitDecisions(previous.get(key));
		next[field] = { ...next[field], [readingId]: value };
		const updated = new Map(previous).set(key, next);
		unitDecisions = updated;
		pushCommand({
			...command,
			undo: () => {
				unitDecisions = new Map(previous);
			},
			redo: () => {
				unitDecisions = new Map(updated);
			},
		});
		return { ok: true };
	}

	/** Bundled plus project reading types. */
	function getReadingTypeVocabulary(): ReadingTypeDefinition[] {
		return resolveReadingTypeVocabulary(projectReadingTypes);
	}

	/** Untyped subreadings; Review nudge, never an error. */
	function getSubreadingsMissingReadingType(): {
		unitIndex: number;
		unitId: string;
		readingIds: string[];
	}[] {
		return forEachUnitView((view, span) => {
			const readingIds = view.readings
				.filter(reading => reading.parentReadingId !== null && reading.readingType === null)
				.map(reading => reading.id);
			return readingIds.length > 0
				? {
						unitIndex: span.startIndex,
						unitId: variationUnitId(span.columnIds[0]),
						readingIds,
					}
				: null;
		});
	}

	function addReading(unitIndex: number, options?: { parentReadingId?: string | null }) {
		const readings = ensureReadingsForUnit(unitIndex);
		const reading = emptyReading(readings, options?.parentReadingId ?? null);
		commitReadingsForUnit(unitIndex, [...readings, reading], {
			type: 'add-reading',
			description: reading.parentReadingId ? 'Add subreading' : 'Add reading',
		});
		return reading.id;
	}

	function getAttestingWitnessIdsForReading(unitIndex: number, readingId: string): string[] {
		return attestingWitnessIds(peekReadingsForUnit(unitIndex), readingId);
	}

	function deleteReading(unitIndex: number, readingId: string) {
		const updated = withoutReading(ensureReadingsForUnit(unitIndex), readingId);
		if (!updated) return;
		commitReadingsForUnit(unitIndex, updated, {
			type: 'delete-reading',
			description: 'Delete reading',
		});
	}

	function moveReadingByOffset(
		unitIndex: number,
		readingId: string,
		offset: number
	): ReorderResult {
		const edit = moveReadingByOffsetIn(ensureReadingsForUnit(unitIndex), readingId, offset);
		if (!edit.ok) return edit;
		commitReadingsForUnit(unitIndex, edit.readings, {
			type: 'reorder-reading',
			description: 'Reorder reading',
		});
		return { ok: true };
	}

	function moveReadingBefore(
		unitIndex: number,
		readingId: string,
		targetReadingId: string
	): ReorderResult {
		const edit = moveReadingBeforeIn(
			ensureReadingsForUnit(unitIndex),
			readingId,
			targetReadingId
		);
		if (!edit.ok) return edit;
		commitReadingsForUnit(unitIndex, edit.readings, {
			type: 'reorder-reading',
			description: 'Reorder reading',
		});
		return { ok: true };
	}

	/** Single stemma derivation; all surfaces read here. */
	function getLocalStemma(unitIndex: number): LocalStemma {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { nodes: [], violations: [], orphanedArcs: [] };
		const view = peekUnitView(unitIndex);
		return projectLocalStemma(
			view.readings,
			readingArcs.get(key) ?? [],
			view.lemmaReadingId,
			unitDecisions.get(key)?.sourceDecision ?? {}
		);
	}

	/** Per-unit threshold; default applied on read. */
	function getConnectivity(unitIndex: number): number | 'absolute' {
		const key = getReadingUnitKey(unitIndex);
		return key ? (unitDecisions.get(key)?.connectivity ?? 10) : 10;
	}

	type ConnectivityError = 'unit-not-found' | 'invalid-connectivity';

	function setConnectivity(
		unitIndex: number,
		connectivity: number | 'absolute'
	): { ok: true } | { ok: false; error: ConnectivityError } {
		if (connectivity !== 'absolute' && (!Number.isInteger(connectivity) || connectivity <= 0)) {
			return { ok: false, error: 'invalid-connectivity' };
		}
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'unit-not-found' };

		const previous = new Map(unitDecisions);
		if (previous.get(key)?.connectivity === connectivity) return { ok: true };
		const next = cloneUnitDecisions(previous.get(key));
		next.connectivity = connectivity;
		const updated = new Map(previous).set(key, next);
		unitDecisions = updated;
		pushCommand({
			type: 'set-connectivity',
			description: 'Set connectivity',
			undo: () => {
				unitDecisions = new Map(previous);
			},
			redo: () => {
				unitDecisions = new Map(updated);
			},
		});
		return { ok: true };
	}

	/** Review worklist warnings, grouped by unit. */
	function getStemmaViolations(): {
		unitIndex: number;
		unitId: string;
		violations: StemmaViolation[];
	}[] {
		return forEachUnitView((_, span) => {
			const violations = getLocalStemma(span.startIndex).violations;
			return violations.length > 0
				? {
						unitIndex: span.startIndex,
						unitId: variationUnitId(span.columnIds[0]),
						violations,
					}
				: null;
		});
	}

	type SourceDecisionError = 'reading-not-found' | 'not-a-main-reading' | 'self-source' | 'cycle';

	/** One source per reading; storage may hold more. */
	function setReadingSource(
		unitIndex: number,
		readingId: string,
		decision: SourceDecision
	): { ok: true } | { ok: false; error: SourceDecisionError } {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'reading-not-found' };
		const readings = ensureReadingsForUnit(unitIndex);
		const stemma = getLocalStemma(unitIndex);
		const nodeFor = (id: string) => stemma.nodes.find(node => node.readingId === id) ?? null;
		const reject = (id: string): { ok: false; error: SourceDecisionError } => ({
			ok: false,
			error: readings.some(reading => reading.id === id)
				? 'not-a-main-reading'
				: 'reading-not-found',
		});

		const node = nodeFor(readingId);
		if (!node) return reject(readingId);
		if (decision.kind === 'derived') {
			if (decision.from === readingId) return { ok: false, error: 'self-source' };
			if (!nodeFor(decision.from)) return reject(decision.from);
			if (wouldCreateCycle(stemma.nodes, readingId, decision.from)) {
				return { ok: false, error: 'cycle' };
			}
		}

		const previousArcs = new Map(readingArcs);
		const previousDecisions = new Map(unitDecisions);

		const posteriorIds = new Set([readingId, ...node.subreadingIds]);
		const keptArcs = (readingArcs.get(key) ?? []).filter(
			arc => !posteriorIds.has(arc.posteriorReadingId)
		);
		const nextArcs =
			decision.kind === 'derived'
				? [
						...keptArcs,
						{
							id: crypto.randomUUID(),
							priorReadingId: decision.from,
							posteriorReadingId: readingId,
						},
					]
				: keptArcs;

		const nextDecisions = cloneUnitDecisions(previousDecisions.get(key));
		const sourceDecisions = { ...nextDecisions.sourceDecision };
		if (decision.kind === 'unclear') sourceDecisions[readingId] = { kind: 'unclear' };
		else delete sourceDecisions[readingId];
		if (Object.keys(sourceDecisions).length > 0) nextDecisions.sourceDecision = sourceDecisions;
		else delete nextDecisions.sourceDecision;

		// Re-recording the current answer is no judgement; skip the undo entry.
		const currentArcs = readingArcs.get(key) ?? [];
		const currentSourceDecisions = unitDecisions.get(key)?.sourceDecision ?? {};
		const arcsUnchanged =
			nextArcs.length === currentArcs.length &&
			nextArcs.every(next =>
				currentArcs.some(
					current =>
						current.priorReadingId === next.priorReadingId &&
						current.posteriorReadingId === next.posteriorReadingId
				)
			);
		const overlayUnchanged =
			Object.keys(currentSourceDecisions).length === Object.keys(sourceDecisions).length &&
			Object.keys(sourceDecisions).every(
				id => currentSourceDecisions[id]?.kind === sourceDecisions[id].kind
			);
		if (arcsUnchanged && overlayUnchanged) return { ok: true };

		const updatedArcs = new Map(previousArcs).set(key, nextArcs);
		const updatedDecisions = new Map(previousDecisions).set(key, nextDecisions);
		readingArcs = updatedArcs;
		unitDecisions = updatedDecisions;
		pushCommand({
			type: 'set-reading-source',
			description:
				decision.kind === 'derived'
					? 'Set reading source'
					: decision.kind === 'unclear'
						? 'Record unclear source'
						: 'Clear source decision',
			undo: () => {
				readingArcs = new Map(previousArcs);
				unitDecisions = new Map(previousDecisions);
			},
			redo: () => {
				readingArcs = new Map(updatedArcs);
				unitDecisions = new Map(updatedDecisions);
			},
		});
		return { ok: true };
	}

	function rerootStemmaOnLemma(
		unitIndex: number
	): { ok: true; removed: number } | { ok: false; error: 'unit-not-found' | 'no-lemma' } {
		const key = getReadingUnitKey(unitIndex);
		if (!key) return { ok: false, error: 'unit-not-found' };
		const stemma = getLocalStemma(unitIndex);
		const lemma = stemma.nodes.find(node => node.isLemma);
		if (!lemma) return { ok: false, error: 'no-lemma' };

		const posteriorIds = new Set([lemma.readingId, ...lemma.subreadingIds]);
		const previous = new Map(readingArcs);
		const arcs = previous.get(key) ?? [];
		const nextArcs = arcs.filter(arc => !posteriorIds.has(arc.posteriorReadingId));
		const removed = arcs.length - nextArcs.length;
		if (removed === 0) return { ok: true, removed };
		const updated = new Map(previous).set(key, nextArcs);
		readingArcs = updated;
		pushCommand({
			type: 'reroot-stemma-on-lemma',
			description: 'Reroot stemma on lemma',
			undo: () => {
				readingArcs = new Map(previous);
			},
			redo: () => {
				readingArcs = new Map(updated);
			},
		});
		return { ok: true, removed };
	}

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
		segment = null;
		selectedVerse = null;
		witnesses = [];
		selectedBook = '';
		selectedChapter = '';
		selectedVerseNum = '';
		rules = [];
		lowercase = false;
		ignoreWordBreaks = false;
		ignoreTokenWhitespace = true;
		ignorePunctuation = false;
		suppliedTextMode = 'clear';
		segmentation = true;
		transcriptionWitnessTreatments = new Map();
		projectReadingTypes = [];
		alignmentColumns = [];
		regularizedTexts = new Map();
		regularizationDiagnostics = [];
		regularizationRuleEffects = [];
		derivedCollationInput = null;
		lastAlignmentInputSignature = null;
		witnessOrder = [];
		selectedColumnIds = new Set();
		selectedCells = new Set();
		focusedColumn = -1;
		focusedRow = -1;
		alignmentDisplayMode = 'regularized';
		alignmentLayout = 'grid';
		selectedUnitIndex = 0;
		classifiedReadings = new Map();
		unitDecisions = new Map();
		readingArcs = new Map();
		orphanedMembers = [];
		commandHistory = [];
		commandIndex = -1;
		if (saveTimeout) clearTimeout(saveTimeout);
	}

	function setSegmentName(name: string) {
		if (!segment) return;
		segment = { ...segment, name };
		markUnsaved();
	}

	function setOrphanedMembers(members: string[]) {
		orphanedMembers = [...new Set(members)];
	}

	function setSegmentMembers(members: string[]) {
		segment = {
			id: segment?.id ?? crypto.randomUUID(),
			name: segment?.name ?? '',
			members: [...new Set(members)],
		};
		orphanedMembers = [];
		markUnsaved();
	}

	function setSegmentMember(member: string) {
		setSegmentMembers([member]);
	}

	function clearSegment() {
		segment = null;
		orphanedMembers = [];
		markUnsaved();
	}

	async function createNewCollation(
		title: string,
		segmentName: string,
		memberIdentifier = segmentMember()
	): Promise<string> {
		if (!projectId) {
			throw new Error('A project must be selected before creating a collation.');
		}
		if (!segmentName.trim()) throw new Error('Collation segment name is required.');
		const memberIdentifiers = segment?.members.length
			? [...new Set(segment.members)]
			: memberIdentifier
				? [memberIdentifier]
				: [];
		if (memberIdentifiers.length === 0)
			throw new Error('Collation segment member is required.');
		const nextSegment: CollationSegment = {
			id: segment?.id ?? crypto.randomUUID(),
			name: segmentName,
			members: memberIdentifiers,
		};
		segment = nextSegment;
		const now = new Date().toISOString();
		const id = await createCollation({
			id: crypto.randomUUID(),
			projectId,
			title,
			verseIdentifier: segmentName,
			segment: nextSegment,
			now,
		});
		collationId = id;
		await persistDocument();
		return id;
	}

	async function loadCollationById(id: string): Promise<boolean> {
		isLoading = true;
		try {
			const loaded = await loadCollation(id);
			if (!loaded) {
				isLoading = false;
				return false;
			}
			if (!loaded.row.projectId) {
				throw new Error('Collation is missing its required project association.');
			}

			collationId = id;

			if (!loaded.artifact?.payload) {
				throw new Error('Collation document artifact missing.');
			}
			workspaceArtifactId = loaded.artifact.id;
			applyCollationDocumentPayload(loaded.artifact.payload);
			await hydrateProjectContext(loaded.row.projectId);
			if (segment) await restoreSelectedVerseFromProjectIndex();
			await refreshOrphanedMembersFromProjectIndex();
			const repairedCollapsedAlignment = hasCollapsedAlignmentRegression();
			if (repairedCollapsedAlignment) {
				rebuildAlignmentFromWitnessTokens();
				saveStatus = 'unsaved';
				scheduleSave();
			}

			if (!repairedCollapsedAlignment) {
				saveStatus = 'saved';
			}
			isLoading = false;
			return true;
		} catch (err) {
			console.error('Failed to load collation:', err);
			isLoading = false;
			return false;
		}
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
		get canUndo() {
			return commandIndex >= 0;
		},
		get canRedo() {
			return commandIndex < commandHistory.length - 1;
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
		get segment() {
			return segment;
		},
		set segment(value) {
			segment = value ? { ...value, members: [...new Set(value.members)] } : null;
			orphanedMembers = [];
			markUnsaved();
		},
		get orphanedMembers() {
			return orphanedMembers;
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
		get regularizationDiagnostics() {
			return regularizationDiagnostics;
		},
		get regularizationRuleEffects() {
			return regularizationRuleEffects;
		},
		get isAlignmentStale() {
			return isAlignmentStale();
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
		get unitDecisions() {
			return unitDecisions;
		},
		get readingArcs() {
			return readingArcs;
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
		getRuleValidationError,
		validateRegularizationPattern,
		getRuleEffects,
		setLowercase,
		setIgnoreWordBreaks,
		setIgnorePunctuation,
		setSuppliedTextMode,
		setSegmentation,
		setSegmentName,
		setSegmentMembers,
		setSegmentMember,
		setOrphanedMembers,
		clearSegment,
		refreshCollationInput,
		buildCollationWitnessInputs,
		refreshWitnessesFromSource,
		refreshWitnessSource,
		refreshAllStaleWitnessSources,
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
		getBaseTextWitnessId,
		getOrderedActiveWitnessIds,
		getWitnessTokensFromAlignment,
		getDisplayedColumnSlots,
		getSegmentSequence,
		peekUnitView,
		peekReadingsForUnit,
		getReadingFamiliesForUnit,
		getDisplayedWitnessIdsForReading,
		getAttestingWitnessIdsForReading,
		getReadingDisplayValuesForUnit,
		primeReadingsForUnit,
		getReadingsForUnit,
		getNonAttestationForUnit,
		getOrphanedDecisionsForUnit,
		getOrphanedUnitDecisions,
		getVariationUnitSpans,
		getVariationUnitSpan,
		getBaseTextForVariationUnit,
		moveWitnessesToReading,
		splitWitnessesIntoNewReading,
		mergeReadings,
		setReadingParent,
		getLemmaReadingId,
		unitNeedsLemmaDecision,
		setLemmaReading,
		getUnitsNeedingLemmaDecision,
		getLemmaDivergence,
		promoteReadingAsFamilyParent,
		updateReadingText,
		updateReadingTextForDisplayMode,
		setReadingType,
		setReadingCertainty,
		getReadingTypeVocabulary,
		getSubreadingsMissingReadingType,
		addReading,
		deleteReading,
		moveReadingByOffset,
		moveReadingBefore,
		getLocalStemma,
		getConnectivity,
		setConnectivity,
		getStemmaViolations,
		setReadingSource,
		rerootStemmaOnLemma,
		moveFocus,
		undo,
		redo,
		reset,
		createNewCollation,
		loadCollationById,
		flushPendingSave,
		pushCommand,
	};
}

export const collationState = createCollationState();
