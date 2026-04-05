<script lang="ts">
	import {
		createStructuredFormWorkContent,
		flattenStructuredFormWorkContent,
	} from '@apatopwa/tei-transcription';
	import { getInlineCarrierEditor } from '$lib/client/transcriptionEditorSchema';
	import type { Editor } from '@tiptap/core';
	import { onMount } from 'svelte';

	import AbbreviationPanel from './AbbreviationPanel.svelte';
	import BubbleMenu from './BubbleMenu.svelte';
	import CorrectionWorkspace from './CorrectionWorkspace.svelte';
	import {
		buildEditorNoteAttrs,
		buildCorrectionNodeAttrs,
		buildGapAttrs,
		buildHandShiftAttrs,
		buildSpaceAttrs,
		buildTeiMilestoneAttrs,
		getCurrentMilestoneValues,
		insertMetamarkForSelection,
		insertMilestoneNode as insertStructuredMilestoneNode,
		insertSelectableCarrierNode,
		updateNodeAttrs,
	} from './editorCommands';
	import EditorToolbar from './EditorToolbar.svelte';
	import InspectorHost from './InspectorHost.svelte';
	import TeiNodeInspector, {
		getNodeLabel,
		type SelectedCarrierNode,
	} from './TeiNodeInspector.svelte';
	import {
		applyAbbreviationMark as applyAbbreviationSelectionMark,
		applyCorrectionMark as applyCorrectionSelectionMark,
		getSelectedInspectorNode,
		inspectorSelectionKey,
		NESTED_INSPECTOR_CARRIER_TYPES,
		readAbbreviationDraft,
		readCorrectionDraft,
		removeAbbreviationMark as removeAbbreviationSelectionMark,
		removeCorrectionMark as removeCorrectionSelectionMark,
	} from './editorInteractions';
	import { normalizeMarginaliaContent } from './formworkContent';
	import type { Correction } from './types';

	interface MarginaliaLocation {
		columnIndex: number;
		lineIndex: number;
		lineDepth: number;
		fromOffset: number;
		toOffset: number;
		lineNode: any;
	}

	interface Props {
		initialContent: unknown;
		onChange: (content: unknown) => void;
		title?: string;
		description?: string;
		storageMode?: 'structured' | 'flattened';
		footerNote?: string;
		toolbarIdPrefix?: string;
	}

	type DrawerMode = 'inspector' | 'correction' | 'abbreviation';

	let {
		initialContent,
		onChange,
		title = 'Nested Content',
		description = '',
		storageMode = 'structured',
		footerNote: _footerNote = '',
		toolbarIdPrefix = 'inline-carrier-toolbar',
	}: Props = $props();

	let editor = $state<Editor | null>(null);
	let editorElement = $state<HTMLElement | null>(null);
	let bubbleMenu = $state<HTMLElement | null>(null);
	let selectedNode = $state<SelectedCarrierNode | null>(null);
	let lastSnapshot = $state('');
	let drawerMode = $state<DrawerMode>('inspector');
	let inspectorPanelOpen = $state(false);
	let lastInspectorSelectionKey = $state('');
	let dismissedInspectorSelectionKey = $state('');
	let correctionDraftCorrections = $state<Correction[]>([]);
	let abbrType = $state('nomSac');
	let abbrExpansion = $state('');
	let abbrRend = $state('¯');
	let currentPositionLabel = $state('Column 1, Line 1');
	let toolbarCursorPosition = $state<{
		columnNumber?: number;
		lineNumber?: number;
		book?: string;
		chapter?: string;
		verse?: string;
	}>({});
	let inspectorDrawerOpen = $derived(
		drawerMode === 'inspector'
			? inspectorPanelOpen && selectedNode !== null
			: drawerMode === 'correction' || drawerMode === 'abbreviation'
	);

	function cloneContent(content: unknown): Record<string, any> {
		if (storageMode === 'flattened') {
			if (Array.isArray(content)) {
				return createStructuredFormWorkContent(JSON.parse(JSON.stringify(content)));
			}
		}
		return normalizeMarginaliaContent(content);
	}

	function serializeContent(content: Record<string, any>): unknown {
		if (storageMode === 'flattened') {
			return flattenStructuredFormWorkContent(content);
		}
		return content;
	}

	function getEditorContent(): Record<string, any> {
		if (!editor) return cloneContent(initialContent);
		return cloneContent(editor.getJSON());
	}

	function updateSelectedNode() {
		if (!editor) {
			selectedNode = null;
			currentPositionLabel = 'Column 1, Line 1';
			toolbarCursorPosition = {};
			return;
		}

		const location = getCurrentLineLocation();
		if (location) {
			currentPositionLabel = `Column ${location.columnIndex + 1}, Line ${location.lineIndex + 1}`;
			toolbarCursorPosition = {
				columnNumber: location.columnIndex + 1,
				lineNumber: location.lineIndex + 1,
				...getCurrentMilestoneValues(editor),
			};
		} else {
			toolbarCursorPosition = getCurrentMilestoneValues(editor);
		}

		selectedNode = getSelectedInspectorNode(editor, NESTED_INSPECTOR_CARRIER_TYPES);
	}

	function dismissInspectorPanel() {
		if (drawerMode === 'inspector') {
			dismissedInspectorSelectionKey = inspectorSelectionKey(selectedNode);
			inspectorPanelOpen = false;
		} else {
			drawerMode = 'inspector';
		}
	}

	function emitContent() {
		const content = getEditorContent();
		const serialized = serializeContent(content);
		lastSnapshot = JSON.stringify(serialized);
		onChange(serialized);
	}

	function syncNormalizedEditorDoc() {
		if (!editor) return false;
		const currentDoc = cloneContent(editor.getJSON());
		const normalizedDoc = renumberMarginaliaDoc(currentDoc);
		const currentSnapshot = JSON.stringify(currentDoc);
		const normalizedSnapshot = JSON.stringify(normalizedDoc);

		if (currentSnapshot === normalizedSnapshot) {
			lastSnapshot = JSON.stringify(serializeContent(normalizedDoc));
			return false;
		}

		lastSnapshot = JSON.stringify(serializeContent(normalizedDoc));
		editor.commands.setContent(normalizedDoc, { emitUpdate: false });
		onChange(serializeContent(normalizedDoc));
		updateSelectedNode();
		return true;
	}

	function fragmentToJsonArray(fragment: any): Array<Record<string, any>> {
		const nodes: Array<Record<string, any>> = [];
		fragment.forEach((node: any) => {
			nodes.push(node.toJSON());
		});
		return nodes;
	}

	function renumberMarginaliaDoc(doc: Record<string, any>): Record<string, any> {
		const columns = Array.isArray(doc.content) ? doc.content : [];
		return {
			...doc,
			content: columns.map((column: Record<string, any>, columnIndex: number) => ({
				...column,
				attrs: {
					...(column.attrs || {}),
					columnNumber: columnIndex + 1,
				},
				content: (Array.isArray(column.content) ? column.content : []).map(
					(line: Record<string, any>, lineIndex: number) => ({
						...line,
						attrs: {
							...(line.attrs || {}),
							lineNumber: lineIndex + 1,
						},
					})
				),
			})),
		};
	}

	function getCurrentLineLocation(): MarginaliaLocation | null {
		if (!editor) return null;
		const { selection } = editor.state;
		const resolvedFrom = selection.$from;
		const resolvedTo = selection.$to;

		let lineDepth = -1;
		for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
			if (resolvedFrom.node(depth).type.name === 'marginaliaLine') {
				lineDepth = depth;
				break;
			}
		}
		if (lineDepth === -1) return null;

		let columnDepth = -1;
		for (let depth = lineDepth - 1; depth >= 0; depth--) {
			if (resolvedFrom.node(depth).type.name === 'marginaliaColumn') {
				columnDepth = depth;
				break;
			}
		}
		if (columnDepth === -1) return null;

		const lineStart = resolvedFrom.start(lineDepth);
		const lineEnd = resolvedFrom.end(lineDepth);
		if (
			selection.from < lineStart ||
			selection.to > lineEnd ||
			resolvedTo.start(lineDepth) !== lineStart
		) {
			return null;
		}

		return {
			columnIndex: resolvedFrom.index(columnDepth - 1),
			lineIndex: resolvedFrom.index(lineDepth - 1),
			lineDepth,
			fromOffset: selection.from - lineStart,
			toOffset: selection.to - lineStart,
			lineNode: resolvedFrom.node(lineDepth),
		};
	}

	function findLineStartPosition(targetColumnIndex: number, targetLineIndex: number): number | null {
		if (!editor) return null;
		let columnIndex = -1;
		let lineIndex = -1;
		let position: number | null = null;

		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'marginaliaColumn') {
				columnIndex += 1;
				lineIndex = -1;
				return true;
			}

			if (node.type.name === 'marginaliaLine') {
				lineIndex += 1;
				if (columnIndex === targetColumnIndex && lineIndex === targetLineIndex) {
					position = pos + 1;
					return false;
				}
			}

			return true;
		});

		return position;
	}

	function restoreSelection(columnIndex: number, lineIndex: number) {
		queueMicrotask(() => {
			if (!editor) return;
			const pos = findLineStartPosition(columnIndex, lineIndex);
			if (pos === null) return;
			editor.chain().focus().setTextSelection(pos).run();
			updateSelectedNode();
		});
	}

	function applyStructuredChange(
		mutate: (doc: Record<string, any>, location: MarginaliaLocation) => {
			doc: Record<string, any>;
			focusColumnIndex: number;
			focusLineIndex: number;
		} | null
	) {
		if (!editor) return;
		const location = getCurrentLineLocation();
		if (!location) return;

		const nextDoc = cloneContent(editor.getJSON());
		const result = mutate(nextDoc, location);
		if (!result) return;

		const normalized = renumberMarginaliaDoc(result.doc);
		lastSnapshot = JSON.stringify(serializeContent(normalized));
		editor.commands.setContent(normalized, { emitUpdate: false });
		onChange(serializeContent(normalized));
		restoreSelection(result.focusColumnIndex, result.focusLineIndex);
	}

	function splitIntoNewColumn() {
		applyStructuredChange((doc, location) => {
			const columns = Array.isArray(doc.content) ? doc.content : [];
			const column = columns[location.columnIndex];
			if (!column) return null;
			const lines = Array.isArray(column.content) ? column.content : [];
			const line = lines[location.lineIndex];
			if (!line) return null;

			const beforeContent = fragmentToJsonArray(location.lineNode.content.cut(0, location.fromOffset));
			const afterContent = fragmentToJsonArray(
				location.lineNode.content.cut(location.toOffset, location.lineNode.content.size)
			);

			const trailingLines = lines.splice(location.lineIndex + 1);
			line.content = beforeContent;
			columns.splice(location.columnIndex + 1, 0, {
				type: 'marginaliaColumn',
				attrs: { columnNumber: 0, breakAttrs: {} },
				content: [
					{
						type: 'marginaliaLine',
						attrs: { lineNumber: 0, breakAttrs: {}, wrapped: false },
						content: afterContent,
					},
					...trailingLines,
				],
			});

			return {
				doc,
				focusColumnIndex: location.columnIndex + 1,
				focusLineIndex: 0,
			};
		});
	}

	function insertCorrectionNode() {
		if (!insertSelectableCarrierNode(editor, 'correctionNode', buildCorrectionNodeAttrs())) return;
		updateSelectedNode();
		emitContent();
	}

	function insertUntranscribed(reason: string, extent: 'partial' | 'full') {
		if (!reason || !editor) return;

		if (extent === 'full') {
			applyStructuredChange((doc, location) => {
				const columns = Array.isArray(doc.content) ? doc.content : [];
				const column = columns[location.columnIndex];
				if (!column) return null;
				const lines = Array.isArray(column.content) ? column.content : [];
				const line = lines[location.lineIndex];
				if (!line) return null;

				line.content = [{ type: 'untranscribed', attrs: { reason, extent: 'full' } }];

				return {
					doc,
					focusColumnIndex: location.columnIndex,
					focusLineIndex: location.lineIndex,
				};
			});
			return;
		}

		if (!insertSelectableCarrierNode(editor, 'untranscribed', { reason, extent: 'partial' })) return;
		updateSelectedNode();
		emitContent();
	}

	function updateNestedNodeAttrs(pos: number, attrs: Record<string, any>) {
		if (!updateNodeAttrs(editor, pos, attrs)) return;

		updateSelectedNode();
		emitContent();
	}

	function openCorrectionPanel() {
		const draft = readCorrectionDraft(editor);
		if (draft === null) return;
		correctionDraftCorrections = draft;

		drawerMode = 'correction';
	}

	function applyCorrectionMark(corrections: Correction[]) {
		if (!applyCorrectionSelectionMark(editor, corrections)) return;
		drawerMode = 'inspector';
	}

	function removeCorrectionMark() {
		if (!removeCorrectionSelectionMark(editor)) return;
		drawerMode = 'inspector';
	}

	function openAbbreviationPanel() {
		const draft = readAbbreviationDraft(editor);
		if (!draft) return;
		abbrType = draft.type;
		abbrExpansion = draft.expansion;
		abbrRend = draft.rend;

		drawerMode = 'abbreviation';
	}

	function applyAbbreviationMark() {
		if (
			!applyAbbreviationSelectionMark(editor, {
				type: abbrType,
				expansion: abbrExpansion,
				rend: abbrRend,
			})
		) {
			return;
		}
		drawerMode = 'inspector';
	}

	function removeAbbreviationMark() {
		if (!removeAbbreviationSelectionMark(editor)) return;
		drawerMode = 'inspector';
	}

	function insertGap(reason: string, unit: string, extent: string) {
		if (!insertSelectableCarrierNode(editor, 'gap', buildGapAttrs(reason, unit, extent))) return;
		updateSelectedNode();
		emitContent();
	}

	function insertSpace(unit: string, extent: string) {
		if (!insertSelectableCarrierNode(editor, 'space', buildSpaceAttrs(unit, extent))) return;
		updateSelectedNode();
		emitContent();
	}

	function insertHandShift(newHand: string, medium: string) {
		const attrs = buildHandShiftAttrs(newHand, medium);
		if (!attrs) return;
		if (!insertSelectableCarrierNode(editor, 'handShift', attrs)) return;
		updateSelectedNode();
		emitContent();
	}

	function insertEditorNote(type: string, text: string) {
		const attrs = buildEditorNoteAttrs(type, text);
		if (!attrs) return;
		if (!insertSelectableCarrierNode(editor, 'teiAtom', attrs)) return;
		updateSelectedNode();
		emitContent();
	}

	function insertMetamark(functionValue: string) {
		if (!insertMetamarkForSelection(editor, functionValue)) return;
		updateSelectedNode();
		emitContent();
	}

	function insertGenericTeiMilestone(unit: string, value: string, ed: string, event: Event) {
		const attrs = buildTeiMilestoneAttrs(unit, value, ed);
		if (!attrs) return;
		if (!insertSelectableCarrierNode(editor, 'teiMilestone', attrs)) return;
		updateSelectedNode();
		emitContent();

		const details = (event.target as HTMLElement).closest('details');
		if (details) details.open = false;
	}

	function insertMilestoneNode(type: 'book' | 'chapter' | 'verse', value: string, event: Event) {
		const result = insertStructuredMilestoneNode(editor, type, value);
		if (result === 'missing-book') {
			alert('Please insert a Book node first');
			return;
		}
		if (result === 'missing-chapter') {
			alert('Please insert a Chapter node first');
			return;
		}
		if (result !== 'ok') return;

		const details = (event.target as HTMLElement).closest('details');
		if (details) details.open = false;
	}

	function toggleWordWrapped() {
		applyStructuredChange((doc, location) => {
			const columns = Array.isArray(doc.content) ? doc.content : [];
			const column = columns[location.columnIndex];
			if (!column) return null;
			const lines = Array.isArray(column.content) ? column.content : [];
			const line = lines[location.lineIndex];
			if (!line) return null;

			line.attrs = {
				...(line.attrs || {}),
				wrapped: !(line.attrs?.wrapped || false),
			};

			return {
				doc,
				focusColumnIndex: location.columnIndex,
				focusLineIndex: location.lineIndex,
			};
		});
	}

	onMount(() => {
		if (!editorElement || !bubbleMenu || editor) {
			return;
		}

		editor = getInlineCarrierEditor(editorElement, bubbleMenu);
		const nextContent = renumberMarginaliaDoc(cloneContent(initialContent));
		editor.commands.setContent(nextContent, { emitUpdate: false });
		lastSnapshot = JSON.stringify(serializeContent(nextContent));
		updateSelectedNode();

		editor.on('selectionUpdate', updateSelectedNode);
		editor.on('update', () => {
			updateSelectedNode();
			if (!syncNormalizedEditorDoc()) {
				emitContent();
			}
		});

		return () => {
			editor?.destroy();
			editor = null;
		};
	});

	$effect(() => {
		const snapshot = JSON.stringify(serializeContent(cloneContent(initialContent)));
		if (!editor || snapshot === lastSnapshot) return;
		const normalized = renumberMarginaliaDoc(cloneContent(initialContent));
		lastSnapshot = JSON.stringify(serializeContent(normalized));
		editor.commands.setContent(normalized, { emitUpdate: false });
		updateSelectedNode();
	});

	$effect(() => {
		const key = inspectorSelectionKey(selectedNode);

		if (!key) {
			lastInspectorSelectionKey = '';
			dismissedInspectorSelectionKey = '';
			inspectorPanelOpen = false;
			return;
		}

		drawerMode = 'inspector';

		if (key !== lastInspectorSelectionKey) {
			lastInspectorSelectionKey = key;
			dismissedInspectorSelectionKey = '';
			inspectorPanelOpen = true;
			return;
		}

		if (!inspectorPanelOpen && dismissedInspectorSelectionKey !== key) {
			inspectorPanelOpen = true;
		}
	});
</script>

<div class="rounded border border-base-300 bg-base-100 p-3 space-y-3">
	<div class="flex items-start justify-between gap-3">
		<div>
			<div class="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">{title}</div>
			{#if description}
				<p class="mt-1 text-xs text-base-content/70">{description}</p>
			{/if}
		</div>
		<div class="rounded bg-base-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/60">
			{currentPositionLabel}
		</div>
	</div>

	<EditorToolbar
		editor={editor}
		idPrefix={toolbarIdPrefix}
		pageName=""
		hasPage={!!editor}
		exportLoading={false}
		cursorPosition={toolbarCursorPosition}
		showPageNameInput={false}
		showInsertPageButton={false}
		showInsertLineButton={false}
		showMarginaliaButton={false}
		showExportButton={false}
		insertColumnTooltip="Split into a new column"
		insertColumnTitle="Split the current marginalia column at the cursor position"
		insertColumnAriaLabel="Split Into New Column"
		onPageNameChange={() => {}}
		onInsertPage={() => {}}
		onInsertColumn={splitIntoNewColumn}
		onToggleWordWrapped={toggleWordWrapped}
		onInsertUntranscribed={insertUntranscribed}
		onInsertGap={insertGap}
		onInsertSpace={insertSpace}
		onInsertHandShift={insertHandShift}
		onInsertEditorNote={insertEditorNote}
		onInsertMarginalia={() => {}}
		onInsertMetamark={insertMetamark}
		onInsertCorrectionNode={insertCorrectionNode}
		onInsertGenericTeiMilestone={insertGenericTeiMilestone}
		onInsertMilestoneNode={insertMilestoneNode}
		onTEIExport={() => {}}
	/>

	<div
		class="inline-carrier-editor-input show-lacunose show-unclear show-abbreviation overflow-x-auto"
		bind:this={editorElement}
		data-testid="inline-carrier-editor"
	></div>

	<BubbleMenu
		bind:editor
		bind:bubbleMenu
		onOpenCorrection={openCorrectionPanel}
		onOpenAbbreviation={openAbbreviationPanel}
	/>

	{#if inspectorDrawerOpen}
		<InspectorHost
			variant="embedded"
			open={inspectorDrawerOpen}
			title={
				drawerMode === 'inspector' && selectedNode
					? getNodeLabel(selectedNode)
					: drawerMode === 'correction'
						? 'Scribal Corrections'
						: 'Abbreviation'
			}
			onClose={dismissInspectorPanel}
		>
			{#if drawerMode === 'inspector' && selectedNode && inspectorPanelOpen}
				<TeiNodeInspector selectedNode={selectedNode} onUpdateNodeAttrs={updateNestedNodeAttrs} />
			{:else if drawerMode === 'correction'}
				<CorrectionWorkspace
					idPrefix="inline-carrier-correction"
					title="Correction Readings"
					description="Apply a correction mark to the current text selection."
					initialCorrections={correctionDraftCorrections}
					applyLabel="Apply to Selection"
					onApply={applyCorrectionMark}
					onRemoveAll={removeCorrectionMark}
					variant="popover"
				/>
			{:else if drawerMode === 'abbreviation'}
				<AbbreviationPanel
					bind:abbrType
					bind:abbrExpansion
					bind:abbrRend
					description="Apply an abbreviation mark to the current text selection."
					onApply={applyAbbreviationMark}
					onRemove={removeAbbreviationMark}
				/>
			{/if}
		</InspectorHost>
	{/if}
</div>
