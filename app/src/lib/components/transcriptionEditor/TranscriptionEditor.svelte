<script lang="ts">
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import { fromProseMirror, toProseMirror } from '@apatopwa/tei-transcription';
	import { syncVerseIndexFromDocument } from '$lib/client/transcription/verse-index';
	import {
		coerceTranscriptionDocument,
		EMPTY_TRANSCRIPTION_DOC,
		serializeTranscriptionDocument,
		TRANSCRIPTION_FORMAT,
		type StoredTranscriptionDocument,
	} from '$lib/client/transcription/content';
	import { externalSyncService } from '$lib/client/transcription/external-sync-service';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import { getEditor } from '$lib/client/transcriptionEditorSchema';
import {
	createColumnSplitTransaction,
	repairManuscriptStructureJson,
} from '$lib/client/transcriptionEditorStructure';
	import { Transcription } from '../../../generated/models/Transcription';
	import { exportTEIDocument } from '$lib/tei/tei-exporter';
	import { Editor } from '@tiptap/core';
	import { NodeSelection } from '@tiptap/pm/state';
	import { onMount } from 'svelte';
	import AbbreviationPanel from './AbbreviationPanel.svelte';
	import BubbleMenu from './BubbleMenu.svelte';
	import EditorToolbar from './EditorToolbar.svelte';
	import InspectorHost from './InspectorHost.svelte';
	import {
		buildEditorNoteAttrs,
		buildCorrectionNodeAttrs,
		buildGapAttrs,
		buildHandShiftAttrs,
		buildSpaceAttrs,
		buildTeiMilestoneAttrs,
		getCurrentMilestoneValues,
		insertMetamarkForSelection,
		insertSelectableCarrierNode,
		insertMilestoneNode as insertStructuredMilestoneNode,
		syncPageFormWorkToContainingPage,
		updateNodeAttrs,
	} from './editorCommands';
	import {
		annotatePageChromeInJson,
		createDefaultFormWorkAttrs,
		extractPageMetadata,
		findFirstLineInsertPos,
		type PageEditorMetadata,
	} from './pageFormwork';
	import { buildPlainTextFormWorkContent } from './formworkContent';
	import { createDefaultMarginaliaAttrs } from './marginalia';
	import CorrectionWorkspace from './CorrectionWorkspace.svelte';
	import StatusBar from './StatusBar.svelte';
	import TeiNodeInspector, { getNodeLabel } from './TeiNodeInspector.svelte';
	import TranscriptionMetadataDialog from './TranscriptionMetadataDialog.svelte';
	import { buildTEIMetadataFromTranscription } from '$lib/tei/transcription-record-metadata';
	import type { Correction } from './types';
	import {
		applyAbbreviationMark,
		applyCorrectionMark,
		DEFAULT_INSPECTOR_CARRIER_TYPES,
		getSelectedTranscriptionQuote,
		getSelectedInspectorNode,
		inspectorSelectionKey,
		readAbbreviationDraft,
		readCorrectionDraft,
		removeAbbreviationMark,
		removeCorrectionMark,
	} from './editorInteractions';
	import type { TranscriptionSelectionQuote } from '$lib/client/iiif/types';

	let {
		transcription,
		data,
		onSaveStateChange,
		onPagesChange,
		onActivePageChange,
		onTextSelectionChange,
		onToggleIiifWorkspace,
		iiifWorkspaceOpen = false,
		toolbarTarget = null,
		statusBarTarget = null,
		scrollToPageRequest = null,
		scrollToVerseRequest = null,
	}: {
		transcription: TranscriptionRecord | undefined | null;
		data: any;
		onSaveStateChange?: (saved: boolean) => void;
		onPagesChange?: (pages: PageEditorMetadata[]) => void;
		onActivePageChange?: (page: PageEditorMetadata | null) => void;
		onTextSelectionChange?: (selection: TranscriptionSelectionQuote | null) => void;
		onToggleIiifWorkspace?: () => void;
		iiifWorkspaceOpen?: boolean;
		toolbarTarget?: HTMLElement | null;
		statusBarTarget?: HTMLElement | null;
		scrollToPageRequest?: { pageId: string; token: number } | null;
		scrollToVerseRequest?: { book: string; chapter: string; verse: string; token: string } | null;
	} = $props();

	let transcriptionElement = $state<HTMLElement | null>(null);
	let editorState = $state<{ editor: Editor | null }>({ editor: null });
	let transcriptionMetadataDialog = $state<any>(null);
	let pageName = $state('');
	let drawerOpen = $state(false);
	let exportLoading = $state(false);
	let markVisibility = $state({
		lacunose: true,
		unclear: true,
		correction: true,
		abbreviation: true,
		punctuation: true,
		untranscribed: true,
		gap: true,
		book: true,
		chapter: true,
		verse: true,
		wrappedArrow: true,
		paragraphStart: true,
	});
	let bubbleMenu = $state<HTMLElement | null>(null);

	let hasPage = $state(false);
	let canonicalDocument = $state<StoredTranscriptionDocument>(EMPTY_TRANSCRIPTION_DOC);

	interface CursorPosition {
		pageName?: string;
		columnNumber?: number;
		lineNumber?: number;
		book?: string;
		chapter?: string;
		verse?: string;
	}

	// Performance optimization: Only rebuild page list when needed (e.g., when drawer opens)
	let pages = $state<PageEditorMetadata[]>([]);
	let pagesNeedUpdate = $state(false);
	let lastScrollToPageToken: number | null = null;
	let lastScrollToVerseToken: string | null = null;

	// Cursor position state for status bar display
	let cursorPosition = $state<CursorPosition>({});
	let selectedTeiNode = $state<{ pos: number; type: string; attrs: Record<string, any> } | null>(
		null
	);
	let lastInspectorSelectionKey = $state('');
	let dismissedInspectorSelectionKey = $state('');
	let inspectorPanelOpen = $state(false);

	// Drawer mode: 'inspector' for carrier nodes, 'correction'/'abbreviation' for text marks
	type DrawerMode = 'inspector' | 'correction' | 'abbreviation';
	let drawerMode = $state<DrawerMode>('inspector');
	let inspectorDrawerOpen = $derived(
		drawerMode === 'inspector'
			? inspectorPanelOpen && selectedTeiNode !== null
			: drawerMode === 'correction' || drawerMode === 'abbreviation'
	);

	// Correction mark editing state
	let correctionDraftCorrections = $state<Correction[]>([]);

	// Abbreviation mark editing state
	let abbrType = $state('nomSac');
	let abbrExpansion = $state('');
	let abbrRend = $state('\u00AF');

	function createEditorPageId(): string {
		if (typeof crypto?.randomUUID === 'function') {
			return `page-${crypto.randomUUID()}`;
		}
		return `page-${Math.random().toString(36).slice(2, 12)}`;
	}

	function createEditorNodeId(prefix: string): string {
		if (typeof crypto?.randomUUID === 'function') {
			return `${prefix}-${crypto.randomUUID()}`;
		}
		return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
	}
	// Helper function to check if document has pages
	function checkForPages(editor: Editor | null): boolean {
		if (!editor) return false;
		let found = false;
		editor.state.doc.descendants(node => {
			if (node.type.name === 'page') {
				found = true;
				return false;
			}
		});
		return found;
	}

	// Helper function to rebuild page list
	function rebuildPageList() {
		if (!editorState.editor) return;
		const pageList: PageEditorMetadata[] = [];
		editorState.editor.state.doc.descendants((node, pos) => {
			if (node.type.name === 'page') {
				const metadata = extractPageMetadata(node, pos);
				metadata.pageOrder = pageList.length + 1;
				pageList.push(metadata);
			}
		});
		pages = pageList;
		onPagesChange?.(pageList);
	}

	function getActivePageMetadata(editor: Editor | null): PageEditorMetadata | null {
		if (!editor) return null;
		const cursorPos = editor.state.selection.from;
		let pageOrder = 0;
		let activePage: PageEditorMetadata | null = null;

		editor.state.doc.descendants((node, pos) => {
			if (node.type.name !== 'page') {
				return true;
			}

			pageOrder += 1;
			const pageStart = pos;
			const pageEnd = pos + node.nodeSize;
			if (cursorPos < pageStart || cursorPos > pageEnd) {
				return false;
			}

			activePage = extractPageMetadata(node, pos);
			activePage.pageOrder = pageOrder;
			return false;
		});

		return activePage;
	}

	function updateActivePageSelection(editor: Editor | null) {
		const activePage = getActivePageMetadata(editor);
		onActivePageChange?.(activePage);
	}

	function updateSelectedTeiNode(editor: Editor | null) {
		selectedTeiNode = getSelectedInspectorNode(editor, DEFAULT_INSPECTOR_CARRIER_TYPES);
	}

	function updateSelectedTextQuote(editor: Editor | null) {
		onTextSelectionChange?.(getSelectedTranscriptionQuote(editor));
	}

	function dismissInspectorPanel() {
		if (drawerMode === 'inspector') {
			dismissedInspectorSelectionKey = inspectorSelectionKey(selectedTeiNode);
			inspectorPanelOpen = false;
		} else {
			drawerMode = 'inspector';
		}
	}

	function openCorrectionDrawer() {
		const draft = readCorrectionDraft(editorState.editor);
		if (draft === null) return;
		correctionDraftCorrections = draft;

		drawerMode = 'correction';
	}

	function applyCorrectionFromDrawer(corrections: Correction[]) {
		if (!applyCorrectionMark(editorState.editor, corrections)) return;
		drawerMode = 'inspector';
	}

	function removeCorrectionFromDrawer() {
		if (!removeCorrectionMark(editorState.editor)) return;
		drawerMode = 'inspector';
	}

	function openAbbreviationDrawer() {
		const draft = readAbbreviationDraft(editorState.editor);
		if (!draft) return;
		abbrType = draft.type;
		abbrExpansion = draft.expansion;
		abbrRend = draft.rend;

		drawerMode = 'abbreviation';
	}

	function applyAbbreviationFromDrawer() {
		if (
			!applyAbbreviationMark(editorState.editor, {
				type: abbrType,
				expansion: abbrExpansion,
				rend: abbrRend,
			})
		) {
			return;
		}
		drawerMode = 'inspector';
	}

	function removeAbbreviationFromDrawer() {
		if (!removeAbbreviationMark(editorState.editor)) return;
		drawerMode = 'inspector';
	}

	function scrollSelectedNodeAboveDrawer() {
		if (!editorState.editor) return;
		const { view } = editorState.editor;
		const domAtPos = view.domAtPos(view.state.selection.from);
		const selectedElement = domAtPos.node instanceof HTMLElement
			? domAtPos.node
			: domAtPos.node.parentElement;
		if (!selectedElement) return;

		// Wait a frame so the drawer transition has started and we can measure
		requestAnimationFrame(() => {
			const drawerHeight = window.innerHeight * 0.5; // max-height: 50vh
			const rect = selectedElement.getBoundingClientRect();
			const visibleBottom = window.innerHeight - drawerHeight;
			// If the selected element is below (or close to) the drawer top, scroll it up
			const margin = 48; // px breathing room above drawer
			if (rect.bottom > visibleBottom - margin) {
				const scrollBy = rect.bottom - (visibleBottom - margin);
				const scrollContainer = transcriptionElement?.closest<HTMLElement>(
					'[data-transcription-scroll-container]'
				);
				if (scrollContainer) {
					scrollContainer.scrollBy({ top: scrollBy, behavior: 'smooth' });
				} else {
					window.scrollBy({ top: scrollBy, behavior: 'smooth' });
				}
			}
		});
	}

	function portal(node: HTMLElement, target: HTMLElement | null) {
		const originalParent = node.parentNode;
		const placeholder = document.createComment('editor-toolbar-portal');
		let currentTarget: HTMLElement | null = null;

		originalParent?.insertBefore(placeholder, node);

		const moveTo = (nextTarget: HTMLElement | null) => {
			if (!nextTarget) {
				if (placeholder.parentNode) {
					placeholder.parentNode.insertBefore(node, placeholder);
				}
				currentTarget = null;
				return;
			}

			if (currentTarget === nextTarget) return;
			nextTarget.appendChild(node);
			currentTarget = nextTarget;
		};

		moveTo(target);

		return {
			update(nextTarget: HTMLElement | null) {
				moveTo(nextTarget);
			},
			destroy() {
				if (placeholder.parentNode) {
					placeholder.parentNode.insertBefore(node, placeholder);
					placeholder.remove();
				}
			},
		};
	}

	// Reactively rebuild page list when drawer opens and updates are pending
	$effect(() => {
		if (drawerOpen && pagesNeedUpdate) {
			rebuildPageList();
			pagesNeedUpdate = false;
		}
	});

	$effect(() => {
		const key = inspectorSelectionKey(selectedTeiNode);

		if (!key) {
			lastInspectorSelectionKey = '';
			dismissedInspectorSelectionKey = '';
			inspectorPanelOpen = false;
			// Don't reset drawerMode here — correction/abbreviation drawers
			// should stay open when text selection changes
			return;
		}

		// A carrier node was selected — switch to inspector mode
		drawerMode = 'inspector';

		if (key !== lastInspectorSelectionKey) {
			lastInspectorSelectionKey = key;
			dismissedInspectorSelectionKey = '';
			inspectorPanelOpen = true;
			scrollSelectedNodeAboveDrawer();
			return;
		}

		if (!inspectorPanelOpen && dismissedInspectorSelectionKey !== key) {
			inspectorPanelOpen = true;
			scrollSelectedNodeAboveDrawer();
		}
	});

	function updatePageName(pos: number, newName: string) {
		if (!editorState.editor) return;
		editorState.editor
			.chain()
			.command(({ tr, state }) => {
				const node = state.doc.nodeAt(pos);
				if (node && node.type.name === 'page') {
					tr.setNodeMarkup(pos, undefined, {
						...node.attrs,
						pageName: newName.trim() || null,
					});
				}
				return true;
			})
			.run();
	}

	function deletePage(pagePos: number) {
		const editor = editorState.editor;
		if (!editor) return;

		editor
			.chain()
			.command(({ tr, state }) => {
				const pageNode = state.doc.nodeAt(pagePos);
				if (!pageNode || pageNode.type.name !== 'page') {
					return false;
				}

				tr.delete(pagePos, pagePos + pageNode.nodeSize);
				return true;
			})
			.run();
	}

	function updatePageFormWork(
		pagePos: number,
		kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature',
		newText: string
	) {
		if (!editorState.editor) return;

		const pageMetadata = pages.find(page => page.pos === pagePos) || null;
		const existing =
			kind === 'pageLabel'
				? pageMetadata?.pageLabel
				: kind === 'runningTitle'
					? pageMetadata?.runningTitle
					: kind === 'catchword'
						? pageMetadata?.catchword
						: pageMetadata?.quireSignature;
		const nextContent = buildPlainTextFormWorkContent(newText);

		editorState.editor
			.chain()
			.command(({ tr, state }) => {
				if (existing?.pos) {
					if (nextContent.length === 0) {
						const node = state.doc.nodeAt(existing.pos);
						if (node) {
							tr.delete(existing.pos, existing.pos + node.nodeSize);
						}
						const pageNode = state.doc.nodeAt(pagePos);
						if (pageNode?.type.name === 'page') {
							tr.setNodeMarkup(pagePos, undefined, {
								...pageNode.attrs,
								[kind]: null,
							});
						}
						return true;
					}

					const node = state.doc.nodeAt(existing.pos);
					if (node?.type.name === 'fw') {
						tr.setNodeMarkup(existing.pos, undefined, {
							...node.attrs,
							content: nextContent,
						});
					}
					const pageNode = state.doc.nodeAt(pagePos);
					if (pageNode?.type.name === 'page') {
						tr.setNodeMarkup(pagePos, undefined, {
							...pageNode.attrs,
							[kind]: newText.trim() || null,
						});
					}
					return true;
				}

				if (nextContent.length === 0) {
					return true;
				}

				const pageNode = state.doc.nodeAt(pagePos);
				if (!pageNode || pageNode.type.name !== 'page') {
					return false;
				}

				const insertPos = findFirstLineInsertPos(pageNode, pagePos);
				if (insertPos === null) {
					return false;
				}

				const formWorkNode = state.schema.nodes.fw?.create(
					createDefaultFormWorkAttrs(kind, newText)
				);
				if (!formWorkNode) {
					return false;
				}

				tr.insert(insertPos, formWorkNode);
				tr.setNodeMarkup(pagePos, undefined, {
					...pageNode.attrs,
					[kind]: newText.trim() || null,
				});
				return true;
			})
			.run();
	}

	function insertMarginalia() {
		if (!editorState.editor) return;

		const attrs = createDefaultMarginaliaAttrs('Marginal', []);
		insertSelectableCarrierNode(editorState.editor, 'fw', attrs);
	}

	onMount(() => {
		const savedVisibility = localStorage.getItem('markVisibility');
		if (savedVisibility) {
			try {
				markVisibility = JSON.parse(savedVisibility);
			} catch (e) {
				console.warn('Failed to parse saved mark visibility:', e);
			}
		}

		// Get reference to the dialog element after mount
		const dialogElement = document.getElementById(
			'transcription-metadata-modal'
		) as HTMLDialogElement;
		if (dialogElement) {
			transcriptionMetadataDialog = dialogElement;
		}

		if (!transcriptionElement || !bubbleMenu || !editorState || !transcription) {
			console.warn('TranscriptionEditor missing required props:', {
				transcriptionElement: !!transcriptionElement,
				bubbleMenu: !!bubbleMenu,
				editorState: !!editorState,
				transcription: !!transcription,
			});
			return;
		}

		try {
			void ensureDjazzkitRuntime().catch(error => {
				console.error('[Autosave] Runtime init failed:', error);
			});
			void externalSyncService.init().catch(error => {
				console.error('[External Sync] Failed to initialize:', error);
			});
			const editor = getEditor(transcriptionElement, bubbleMenu);
			const initialDocument =
				coerceTranscriptionDocument(transcription.content_json) ?? EMPTY_TRANSCRIPTION_DOC;
			canonicalDocument = initialDocument;
			const initialPm = toProseMirror(initialDocument) as any;
			annotatePageChromeInJson(initialPm);
			const repairResult = repairManuscriptStructureJson(initialPm, {
				framedPageZoneOrder: 'visual',
				ensureNodeIds: true,
			});
			if (repairResult.repaired && repairResult.issues.length > 0) {
				console.warn('[Transcription] Repaired invalid manuscript content during editor init:', repairResult.issues);
			}
			editor.commands.setContent(repairResult.doc, { emitUpdate: false });

			// Set editor state once (not on every transaction)
			editorState.editor = editor;
			if (repairResult.repaired) {
				const repairedJson = editor.getJSON();
				onSaveStateChange?.(false);
				debouncedSyncVerseIndex(repairedJson);
				debouncedAutosave(repairedJson);
			}

			// Performance optimization: Only track structural changes, not every edit
				editor.on('update', ({ transaction }: { transaction: any }) => {
					if (transaction.docChanged) {
						onSaveStateChange?.(false);
						// Mark pages as needing update (will recalculate when drawer opens)
						pagesNeedUpdate = true;
						if (iiifWorkspaceOpen || onPagesChange) {
							rebuildPageList();
							pagesNeedUpdate = false;
						}
						// Update hasPage flag to enable/disable buttons
						hasPage = checkForPages(editor);
					const editorJson = editor.getJSON();
					debouncedSyncVerseIndex(editorJson);
					debouncedAutosave(editorJson);
					}
					// Always update cursor position with debouncing
					debouncedUpdateCursorPosition();
					updateActivePageSelection(editor);
					updateSelectedTeiNode(editor);
					updateSelectedTextQuote(editor);
				});

			// Update cursor position when selection changes (for cursor movement without content changes)
					editor.on('selectionUpdate', () => {
					debouncedUpdateCursorPosition();
					updateActivePageSelection(editor);
					updateSelectedTeiNode(editor);
					updateSelectedTextQuote(editor);
				});

			// Initialize hasPage and pages on mount
				hasPage = checkForPages(editor);
				rebuildPageList();
				debouncedSyncVerseIndex(editor.getJSON());
				updateActivePageSelection(editor);
				updateSelectedTeiNode(editor);
				updateSelectedTextQuote(editor);

			// Add listener for modal open event
			const modal = document.getElementById(
				'transcription-metadata-modal'
			) as HTMLDialogElement;
			const handleVisibilityChange = () => {
				if (document.visibilityState === 'hidden') {
					void flushAutosave();
				}
			};
			const handleBeforeUnload = () => {
				void flushAutosave();
			};
			document.addEventListener('visibilitychange', handleVisibilityChange);
			window.addEventListener('beforeunload', handleBeforeUnload);
			if (modal) {
				const handleModalToggle = () => {
					// When modal is open (has open attribute), rebuild page list if needed
					if (modal.open && pagesNeedUpdate) {
						rebuildPageList();
						pagesNeedUpdate = false;
					}
				};

				modal.addEventListener('toggle', handleModalToggle);

				return () => {
					void flushAutosave();
					editor.destroy();
					modal.removeEventListener('toggle', handleModalToggle);
					document.removeEventListener('visibilitychange', handleVisibilityChange);
					window.removeEventListener('beforeunload', handleBeforeUnload);
				};
			}

			return () => {
				void flushAutosave();
				editor.destroy();
				document.removeEventListener('visibilitychange', handleVisibilityChange);
				window.removeEventListener('beforeunload', handleBeforeUnload);
			};
		} catch (error) {
			console.error('Failed to initialize editor:', error);
		}
	});

	$effect(() => {
		localStorage.setItem('markVisibility', JSON.stringify(markVisibility));
	});

	function insertUntranscribed(reason: string, extent: 'partial' | 'full') {
		if (!reason || !editorState.editor) return;

		const { state, view } = editorState.editor;

		if (extent === 'full') {
			// For "full", we need to ensure it's the only content on the line
			const from = state.selection.$from;
			let linePos: number | null = null;
			let lineNode: any = null;

			state.doc.nodesBetween(from.pos, from.pos, (node, pos) => {
				if (node.type.name === 'line') {
					linePos = pos;
					lineNode = node;
					return false;
				}
			});

			if (linePos !== null && lineNode) {
				const lineStart = linePos + 1;
				const lineEnd = linePos + (lineNode.nodeSize as number) - 1;
				const tr = state.tr;

				// Clear all content in the line
				if (lineNode.content.size > 0) {
					tr.delete(lineStart, lineEnd);
				}

				// Insert the untranscribed milestone
				tr.insert(
					lineStart,
					state.schema.nodes.untranscribed.create({
						reason,
						extent: 'full',
					})
				);
				tr.setSelection(NodeSelection.create(tr.doc, lineStart));

				view.dispatch(tr);
			}
		} else {
			insertSelectableCarrierNode(editorState.editor, 'untranscribed', { reason, extent: 'partial' });
		}
	}

	function insertGap(reason: string, unit: string, extent: string) {
		insertSelectableCarrierNode(editorState.editor, 'gap', buildGapAttrs(reason, unit, extent));
	}

	function insertSpace(unit: string, extent: string) {
		insertSelectableCarrierNode(editorState.editor, 'space', buildSpaceAttrs(unit, extent));
	}

	function insertHandShift(newHand: string, medium: string) {
		const attrs = buildHandShiftAttrs(newHand, medium);
		if (!attrs) return;
		insertSelectableCarrierNode(editorState.editor, 'handShift', attrs);
	}

	function insertEditorNote(type: string, text: string) {
		const attrs = buildEditorNoteAttrs(type, text);
		if (!attrs) return;
		insertSelectableCarrierNode(editorState.editor, 'teiAtom', attrs);
	}

	function insertMetamark(functionValue: string) {
		insertMetamarkForSelection(editorState.editor, functionValue);
	}

	function insertCorrectionNode() {
		insertSelectableCarrierNode(editorState.editor, 'correctionNode', buildCorrectionNodeAttrs());
	}

	function toggleWordWrapped() {
		const editor = editorState.editor;
		if (!editor) return;
		const { state, view } = editor;
		const from = state.selection.$from;
		let lineNode: any = null;
		let linePos = null;
		state.doc.nodesBetween(from.pos, from.pos, (node, pos) => {
			if (node.type.name === 'line') {
				lineNode = node as any;
				linePos = pos;
				return false;
			}
		});
		if (lineNode && linePos !== null) {
			const newWrapped = !lineNode.attrs.wrapped;
			const newAttrs = { ...lineNode.attrs, wrapped: newWrapped };
			const tr = state.tr.setNodeMarkup(linePos, null, newAttrs);
			view.dispatch(tr);
			// Note: editor.on('update') will handle marking changes
		}
	}

	function toggleParagraphStart() {
		const editor = editorState.editor;
		if (!editor) return;
		const { state, view } = editor;
		const from = state.selection.$from;
		let lineNode: any = null;
		let linePos: number | null = null;
		state.doc.nodesBetween(from.pos, from.pos, (node: any, pos: number) => {
			if (node.type.name === 'line') {
				lineNode = node;
				linePos = pos;
				return false;
			}
		});
		if (lineNode && linePos !== null) {
			const newValue = !lineNode.attrs['paragraph-start'];
			const newAttrs = { ...lineNode.attrs, 'paragraph-start': newValue };
			const tr = state.tr.setNodeMarkup(linePos, null, newAttrs);
			view.dispatch(tr);
		}
	}

	function insertPage() {
		const editor = editorState.editor;
		if (!editor) return;

		editor.commands.insertContent({
			type: 'page',
			attrs: { pageId: createEditorPageId(), pageName: pageName || null },
			content: [
				{
					type: 'column',
					attrs: { columnNumber: 1, columnId: createEditorNodeId('col') },
					content: [
						{
							type: 'line',
							attrs: { lineNumber: 1, lineId: createEditorNodeId('line') },
						},
					],
				},
			],
		});

		// Performance optimization: Set hasPage flag instead of checking entire document
		hasPage = true;

		const { state } = editor;
		let linePosFound: number | null = null;
		state.doc.descendants((node, pos) => {
			if (node.type.name === 'line' && linePosFound === null) {
				linePosFound = pos;
			}
		});

		if (linePosFound !== null) {
			editor.commands.focus('end');
		}

		pageName = '';
	}

	function insertFramedPage() {
		const editor = editorState.editor;
		if (!editor) return;

		const zones = ['top', 'left', 'right', 'bottom', 'center'] as const;
		const columns = zones.map((zone, i) => ({
			type: 'column',
			attrs: { columnNumber: i + 1, zone, columnId: createEditorNodeId('col') },
			content: [
				{ type: 'line', attrs: { lineNumber: 1, lineId: createEditorNodeId('line') } },
			],
		}));

		editor.commands.insertContent({
			type: 'page',
			attrs: { pageId: createEditorPageId(), pageName: pageName || null },
			content: columns,
		});

		hasPage = true;
		editor.commands.focus('end');
		pageName = '';
	}

	function insertColumn() {
		const { state, view } = editorState.editor || {};
		if (!state || !view) return;

		const tr = createColumnSplitTransaction(state);
		if (!tr) return;

		view.dispatch(tr);
	}

	function getCurrentCursorPosition(): CursorPosition {
		const editor = editorState.editor;
		if (!editor) return {};

		const result: CursorPosition = {};
		const { state } = editor;
		const from = state.selection.from;
		const resolvedFrom = state.selection.$from;

		// Find nearest page node
		let foundPageNode: any = null;
		state.doc.nodesBetween(0, from, (node: any) => {
			if (node.type.name === 'page') {
				foundPageNode = node;
			}
		});
		if (foundPageNode) {
			result.pageName = foundPageNode.attrs.pageName || undefined;
		}

		// Find nearest column node
		let foundColumnNode: any = null;
		state.doc.nodesBetween(0, from, (node: any) => {
			if (node.type.name === 'column') {
				foundColumnNode = node;
			}
		});
		if (foundColumnNode) {
			result.columnNumber = foundColumnNode.attrs.columnNumber;
		}

		let lineDepth = -1;
		for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
			if (resolvedFrom.node(depth).type.name === 'line') {
				lineDepth = depth;
				break;
			}
		}
		if (lineDepth !== -1) {
			result.lineNumber = resolvedFrom.index(lineDepth - 1) + 1;
		}

		// Get milestone values (book, chapter, verse)
		const milestones = getCurrentMilestoneValues(editor);
		result.book = milestones.book;
		result.chapter = milestones.chapter;
		result.verse = milestones.verse;

		return result;
	}

	function createDebouncedGetCurrentCursorPosition(delayMs: number = 500) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let lastRun = 0;

		return () => {
			const now = Date.now();
			const timeSinceLastRun = now - lastRun;

			// Clear existing timeout
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}

			// If enough time has passed, run immediately
			if (timeSinceLastRun >= delayMs) {
				lastRun = now;
				const newPosition = getCurrentCursorPosition();
				cursorPosition = newPosition;
			} else {
				// Otherwise, schedule for later
				const remainingDelay = delayMs - timeSinceLastRun;
				timeoutId = setTimeout(() => {
					lastRun = Date.now();
					const newPosition = getCurrentCursorPosition();
					cursorPosition = newPosition;
					timeoutId = null;
				}, remainingDelay);
			}
		};
	}

	function coerceEditorJsonToDocument(editorJson: unknown): StoredTranscriptionDocument | null {
		try {
			const editorDocument = fromProseMirror(editorJson as any);
			return mergeWithCanonicalDocument(canonicalDocument, editorDocument);
		} catch (error) {
			console.error('[Transcription] Failed to convert editor state to AST:', error);
			return null;
		}
	}

	function mergeWithCanonicalDocument(
		baseDocument: StoredTranscriptionDocument,
		editorDocument: StoredTranscriptionDocument
	): StoredTranscriptionDocument {
		return {
			...editorDocument,
			teiAttrs: baseDocument.teiAttrs,
			textAttrs: baseDocument.textAttrs,
			bodyAttrs: baseDocument.bodyAttrs,
			teiHeader: baseDocument.teiHeader,
			front: baseDocument.front,
			back: baseDocument.back,
			textLeading: baseDocument.textLeading,
			textBetweenFrontBody: baseDocument.textBetweenFrontBody,
			textBetweenBodyBack: baseDocument.textBetweenBodyBack,
			textTrailing: baseDocument.textTrailing,
			resourceNodes: baseDocument.resourceNodes,
			nestedTei: baseDocument.nestedTei,
			facsimile: baseDocument.facsimile,
			standOff: baseDocument.standOff,
			sourceDoc: baseDocument.sourceDoc,
		};
	}

	function createDebouncedVerseIndexSync(delayMs: number = 1200) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		return (editorJson: unknown) => {
			const document = coerceEditorJsonToDocument(editorJson);
			if (!document) return;
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			timeoutId = setTimeout(() => {
				timeoutId = null;
				if (!transcription?._djazzkit_id) return;
				syncVerseIndexFromDocument(transcription._djazzkit_id, document).catch((error: unknown) => {
					console.error('[Verse Index] Failed to sync verse index:', error);
				});
			}, delayMs);
		};
	}

	function createDebouncedAutosave(delayMs: number = 1000) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let pendingDocument: StoredTranscriptionDocument | null = null;
		let saveInFlight = false;

		const persist = async (document: StoredTranscriptionDocument) => {
			const currentTranscription = transcription;
			if (!currentTranscription?._djazzkit_id) return false;
			try {
				const now = new Date().toISOString();
				await ensureDjazzkitRuntime();
				await Transcription.objects.update(currentTranscription._djazzkit_id, {
					content_json: serializeTranscriptionDocument(document),
					format: TRANSCRIPTION_FORMAT,
					updated_at: now,
					_djazzkit_updated_at: now,
				});
				externalSyncService.enqueueSync(currentTranscription, document);
				return true;
			} catch (error) {
				console.error('[Autosave] Failed to persist transcription content:', error);
				return false;
			}
		};

		const flush = async () => {
			if (saveInFlight || !pendingDocument) return;
			saveInFlight = true;
			const nextDocument = pendingDocument;
			pendingDocument = null;
			const saved = await persist(nextDocument);
			saveInFlight = false;
			if (pendingDocument) {
				await flush();
				return;
			}
			if (saved) {
				onSaveStateChange?.(true);
			}
		};

		const schedule = (editorJson: unknown) => {
			const document = coerceEditorJsonToDocument(editorJson);
			if (!document) return;
			pendingDocument = document;
			canonicalDocument = document;
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			timeoutId = setTimeout(() => {
				timeoutId = null;
				void flush();
			}, delayMs);
		};

		return {
			schedule,
			flush: async () => {
				if (timeoutId !== null) {
					clearTimeout(timeoutId);
					timeoutId = null;
				}
				await flush();
			},
		};
	}

	// Create debounced cursor position updater
	let debouncedUpdateCursorPosition = createDebouncedGetCurrentCursorPosition(500);
	let debouncedSyncVerseIndex = createDebouncedVerseIndexSync();
	const autosave = createDebouncedAutosave();
	const debouncedAutosave = autosave.schedule;
	const flushAutosave = autosave.flush;

	function insertMilestoneNode(type: 'book' | 'chapter' | 'verse', value: string, event: Event) {
		if (!editorState.editor || !value) return;
		const result = insertStructuredMilestoneNode(editorState.editor, type, value);
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

	function insertGenericTeiMilestone(unit: string, value: string, ed: string, event: Event) {
		const attrs = buildTeiMilestoneAttrs(unit, value, ed);
		if (!attrs || !attrs.teiAttrs?.unit) return;
		insertSelectableCarrierNode(editorState.editor, 'teiMilestone', attrs);

		const details = (event.target as HTMLElement).closest('details');
		if (details) details.open = false;
	}

	async function handleTEIExport() {
		if (!editorState.editor || !transcription) {
			return;
		}

		exportLoading = true;

		try {
			const exportDocument = coerceEditorJsonToDocument(editorState.editor.getJSON());
			if (!exportDocument) {
				throw new Error('Failed to convert editor content to canonical transcription document');
			}
			const metadata = buildTEIMetadataFromTranscription(transcription);
			const teiXml = exportTEIDocument(exportDocument, metadata);

			const blob = new Blob([teiXml], { type: 'application/xml' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `${transcription.title || 'transcription'}.xml`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('TEI export error:', error);
		} finally {
			exportLoading = false;
		}
	}

	function updateCarrierNodeAttrs(pos: number, attrs: Record<string, any>) {
		if (!updateNodeAttrs(editorState.editor, pos, attrs, syncPageFormWorkToContainingPage)) return;

		updateSelectedTeiNode(editorState.editor);
	}

	function forcePageRender(pageNode: HTMLElement | null): () => void {
		if (!pageNode) return () => {};

		const previousContentVisibility = pageNode.style.contentVisibility;
		const previousContainIntrinsicSize = pageNode.style.containIntrinsicSize;
		pageNode.style.contentVisibility = 'visible';
		pageNode.style.containIntrinsicSize = 'auto';

		return () => {
			pageNode.style.contentVisibility = previousContentVisibility;
			pageNode.style.containIntrinsicSize = previousContainIntrinsicSize;
		};
	}

	function getVerticalScrollHost(node: HTMLElement | null): HTMLElement | Window {
		let current = node?.parentElement ?? null;
		while (current) {
			const style = window.getComputedStyle(current);
			if (
				(style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') &&
				current.scrollHeight > current.clientHeight + 1
			) {
				return current;
			}
			current = current.parentElement;
		}

		return window;
	}

	function isWindowScrollHost(host: HTMLElement | Window): host is Window {
		return host === window;
	}

	function scrollNodeWithinHost(
		node: HTMLElement,
		host: HTMLElement | Window,
		options: { behavior: ScrollBehavior; block: 'start' | 'center'; offset?: number }
	) {
		const offset = options.offset ?? 0;
		const rect = node.getBoundingClientRect();

		if (isWindowScrollHost(host)) {
			const viewportHeight = window.innerHeight;
			const top =
				options.block === 'start'
					? rect.top + window.scrollY - offset
					: rect.top + window.scrollY - Math.max((viewportHeight - rect.height) / 2, 0) - offset;
			window.scrollTo({ top: Math.max(0, top), behavior: options.behavior });
			return;
		}

		const hostRect = host.getBoundingClientRect();
		const top =
			options.block === 'start'
				? host.scrollTop + (rect.top - hostRect.top) - offset
				: host.scrollTop + (rect.top - hostRect.top) - Math.max((host.clientHeight - rect.height) / 2, 0) - offset;
		host.scrollTo({ top: Math.max(0, top), behavior: options.behavior });
	}

	function isNodeNearViewportTarget(
		node: HTMLElement,
		host: HTMLElement | Window,
		options: { block: 'start' | 'center'; offset?: number; tolerance?: number }
	): boolean {
		const tolerance = options.tolerance ?? 96;
		const offset = options.offset ?? 0;
		const rect = node.getBoundingClientRect();
		const hostTop = isWindowScrollHost(host) ? 0 : host.getBoundingClientRect().top;
		const hostHeight = isWindowScrollHost(host) ? window.innerHeight : host.clientHeight;
		if (options.block === 'start') {
			const targetTop = rect.top - hostTop;
			return Math.abs(targetTop - offset) <= tolerance;
		}

		const targetCenter = rect.top - hostTop + rect.height / 2;
		const viewportCenter = hostHeight / 2;
		return Math.abs(targetCenter - viewportCenter) <= tolerance;
	}

	function findVerseContentAnchor(milestoneNode: HTMLElement): HTMLElement {
		const root = transcriptionElement;
		if (!root) return milestoneNode;

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		walker.currentNode = milestoneNode;

		let current: Node | null = walker.nextNode();
		while (current) {
			if (current.textContent?.trim()) {
				const parent = current.parentElement;
				const decorativeAncestor = parent?.closest(
					'[contenteditable="false"], .tei-inline-badge, .tei-inline-badge-shell, .wrapped-arrow'
				);
				if (!decorativeAncestor) {
					return (
						parent?.closest<HTMLElement>('.line, .marginalia-line, .line-content') ??
						parent ??
						milestoneNode
					);
				}
			}

			current = walker.nextNode();
		}

		return milestoneNode.closest<HTMLElement>('.line, .marginalia-line, .line-content') ?? milestoneNode;
	}

	$effect(() => {
		if (!scrollToPageRequest || scrollToPageRequest.token === lastScrollToPageToken) {
			return;
		}
		lastScrollToPageToken = scrollToPageRequest.token;
		requestAnimationFrame(() => {
			const pageNodes = transcriptionElement?.querySelectorAll<HTMLElement>('[data-page-id]') || [];
			const target = Array.from(pageNodes).find(
				node => node.dataset.pageId === scrollToPageRequest.pageId
			);
			if (!target) return;

			const scrollHost = getVerticalScrollHost(target);
			scrollNodeWithinHost(target, scrollHost, {
				behavior: 'smooth',
				block: 'center',
				offset: 24,
			});
		});
	});

	$effect(() => {
		if (
			!scrollToVerseRequest ||
			scrollToVerseRequest.token === lastScrollToVerseToken ||
			!editorState.editor ||
			!transcriptionElement
		) {
			return;
		}

		requestAnimationFrame(() => {
			const verseNodes = transcriptionElement?.querySelectorAll<HTMLElement>('[data-verse]') || [];
			const milestoneTarget = Array.from(verseNodes).find(
				node =>
					node.dataset.book === scrollToVerseRequest.book &&
					node.dataset.chapter === scrollToVerseRequest.chapter &&
					node.dataset.verse === scrollToVerseRequest.verse
			);
			if (!milestoneTarget) return;

			const target = findVerseContentAnchor(milestoneTarget);

			const targetPage = target.closest<HTMLElement>('[data-page-id]');
			const restorePageRender = forcePageRender(targetPage);
			const scrollHost = getVerticalScrollHost(targetPage ?? target);
			if (targetPage) {
				scrollNodeWithinHost(targetPage, scrollHost, {
					behavior: 'auto',
					block: 'start',
					offset: 96,
				});
			}

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					lastScrollToVerseToken = scrollToVerseRequest.token;
					scrollNodeWithinHost(target, scrollHost, {
						behavior: 'auto',
						block: 'start',
						offset: 120,
					});
					window.setTimeout(() => {
						if (scrollToVerseRequest.token !== lastScrollToVerseToken) return;
						if (
							!isNodeNearViewportTarget(target, scrollHost, {
								block: 'start',
								offset: 120,
								tolerance: 64,
							})
						) {
							scrollNodeWithinHost(target, scrollHost, {
								behavior: 'auto',
								block: 'start',
								offset: 120,
							});
						}
						restorePageRender();
					}, 150);
				});
			});
		});
	});

</script>

	<div class="relative flex min-w-max flex-col items-center">
		{#if editorState.editor}
			<div use:portal={toolbarTarget} class="w-full">
				<EditorToolbar
					editor={editorState.editor}
					idPrefix="main-editor-toolbar"
					{pageName}
					{hasPage}
					{exportLoading}
					{cursorPosition}
					iiifWorkspaceOpen={iiifWorkspaceOpen}
					sticky={!toolbarTarget}
					onPageNameChange={name => (pageName = name)}
					onToggleIiifWorkspace={onToggleIiifWorkspace}
					onInsertPage={insertPage}
					onInsertFramedPage={insertFramedPage}
					onInsertColumn={insertColumn}
					onToggleWordWrapped={toggleWordWrapped}
					onToggleParagraphStart={toggleParagraphStart}
					onInsertUntranscribed={insertUntranscribed}
					onInsertGap={insertGap}
					onInsertSpace={insertSpace}
					onInsertHandShift={insertHandShift}
					onInsertEditorNote={insertEditorNote}
					onInsertMarginalia={insertMarginalia}
					onInsertMetamark={insertMetamark}
					onInsertCorrectionNode={insertCorrectionNode}
					onInsertGenericTeiMilestone={insertGenericTeiMilestone}
					onInsertMilestoneNode={insertMilestoneNode}
					onTEIExport={handleTEIExport}
				/>
			</div>
		{/if}

	<BubbleMenu
		bind:editor={editorState.editor}
		bind:bubbleMenu
		onOpenCorrection={openCorrectionDrawer}
		onOpenAbbreviation={openAbbreviationDrawer}
	/>

	<div
		bind:this={transcriptionElement}
		class="prose max-w-none w-full overflow-visible"
		class:show-lacunose={markVisibility.lacunose}
		class:show-unclear={markVisibility.unclear}
		class:show-correction={markVisibility.correction}
		class:show-abbreviation={markVisibility.abbreviation}
		class:show-punctuation={markVisibility.punctuation}
		class:show-untranscribed={markVisibility.untranscribed}
		class:show-gap={markVisibility.gap}
		class:show-book={markVisibility.book}
		class:show-chapter={markVisibility.chapter}
		class:show-verse={markVisibility.verse}
		class:show-wrappedArrow={markVisibility.wrappedArrow}
		class:show-paragraphStart={markVisibility.paragraphStart}
	></div>
</div>

<InspectorHost
	variant="fixed"
	open={inspectorDrawerOpen}
	title={
		drawerMode === 'inspector' && selectedTeiNode
			? getNodeLabel(selectedTeiNode)
			: drawerMode === 'correction'
				? 'Scribal Corrections'
				: 'Abbreviation'
	}
	onClose={dismissInspectorPanel}
>
	{#if drawerMode === 'inspector' && selectedTeiNode && inspectorPanelOpen}
		<TeiNodeInspector selectedNode={selectedTeiNode} onUpdateNodeAttrs={updateCarrierNodeAttrs} />
	{:else if drawerMode === 'correction'}
		<CorrectionWorkspace
			idPrefix="drawer-correction"
			title="Correction Readings"
			description="Add or edit correction readings for the selected text."
			initialCorrections={correctionDraftCorrections}
			applyLabel="Apply"
			onApply={applyCorrectionFromDrawer}
			onRemoveAll={removeCorrectionFromDrawer}
		/>
	{:else if drawerMode === 'abbreviation'}
		<AbbreviationPanel
			bind:abbrType
			bind:abbrExpansion
			bind:abbrRend
			description="Apply an abbreviation mark to the current text selection."
			onApply={applyAbbreviationFromDrawer}
			onRemove={removeAbbreviationFromDrawer}
		/>
	{/if}
</InspectorHost>

<TranscriptionMetadataDialog
	{transcription}
	{canonicalDocument}
	{pages}
	{data}
	onUpdatePageName={updatePageName}
	onDeletePage={deletePage}
	onUpdatePageFormWork={updatePageFormWork}
/>
<div use:portal={statusBarTarget} class="w-full">
	<StatusBar
		bind:markVisibility
		bind:transcriptionMetadataDialog
		{cursorPosition}
		sticky={!statusBarTarget}
	/>
</div>

<style>
	:global(.floating-menu) {
		position: fixed;
		display: flex;
		border-radius: 0.5rem;
		transition:
			opacity 0.1s,
			visibility 0.1s;
		opacity: 0;
		visibility: hidden;
		z-index: 50;
		pointer-events: auto;
	}

	:global(.floating-menu.show) {
		opacity: 1;
		visibility: visible;
	}

	:global(.prose, .ProseMirror, .ProseMirror-focused) {
		outline: none !important;
		box-shadow: none !important;
	}

	:global(.selection-highlight) {
		background-color: oklch(0.8 0.1 250 / 0.4);
		border-radius: 2px;
	}

	:global(.selection-highlight-node),
	:global(.ProseMirror-selectednode) {
		outline: 2px solid oklch(0.6 0.15 250);
		outline-offset: 1px;
		border-radius: 0.5rem;
	}

	:global(.page) {
		overflow: visible;
		min-width: fit-content;
	}

	:global(.column) {
		overflow: visible;
		position: relative;
		min-width: 20rem;
	}

	:global(.line) {
		overflow: visible;
		position: relative;
	}

	:global(.marginalia-node) {
		max-width: 14rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		position: relative;
		z-index: 3;
		padding: 0.15rem 0.35rem;
	}

	:global(.line-content) {
		overflow: visible;
	}

	:global(.tei-inline-badge) {
		vertical-align: middle;
	}

	:global(.tei-inline-badge-icon) {
		flex: none;
	}

	:global(.tei-atom-node[data-tag="note"]) {
		width: auto;
		height: auto;
		min-width: 0;
		min-height: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	:global(.tei-note-badge) {
		color: var(--color-info-content);
		width: auto;
		height: auto;
		min-width: 0;
		min-height: 0;
		border-radius: 0.35rem;
		overflow: visible;
		gap: 0;
	}

	:global(.tei-note-badge-glyph) {
		display: block;
		width: 1rem;
		height: 1rem;
		flex: none;
		background-color: currentColor;
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M88 96a8 8 0 0 1 8-8h64a8 8 0 0 1 0 16H96a8 8 0 0 1-8-8Zm8 40h64a8 8 0 0 0 0-16H96a8 8 0 0 0 0 16Zm32 16H96a8 8 0 0 0 0 16h32a8 8 0 0 0 0-16ZM224 48V156.69A15.86 15.86 0 0 1 219.31 168L168 219.31A15.86 15.86 0 0 1 156.69 224H48a16 16 0 0 1-16-16V48a16 16 0 0 1 16-16H208a16 16 0 0 1 16 16ZM48 208H152V160a8 8 0 0 1 8-8h48V48H48Zm120-40v28.7L196.69 168Z'/%3E%3C/svg%3E");
		mask-repeat: no-repeat;
		mask-position: center;
		mask-size: contain;
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M88 96a8 8 0 0 1 8-8h64a8 8 0 0 1 0 16H96a8 8 0 0 1-8-8Zm8 40h64a8 8 0 0 0 0-16H96a8 8 0 0 0 0 16Zm32 16H96a8 8 0 0 0 0 16h32a8 8 0 0 0 0-16ZM224 48V156.69A15.86 15.86 0 0 1 219.31 168L168 219.31A15.86 15.86 0 0 1 156.69 224H48a16 16 0 0 1-16-16V48a16 16 0 0 1 16-16H208a16 16 0 0 1 16 16ZM48 208H152V160a8 8 0 0 1 8-8h48V48H48Zm120-40v28.7L196.69 168Z'/%3E%3C/svg%3E");
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
		-webkit-mask-size: contain;
	}

	:global(.hand-shift-badge) {
		gap: 0;
	}

	:global(.hand-shift-badge-glyph) {
		display: block;
		width: 1rem;
		height: 1rem;
		flex: none;
		background-color: currentColor;
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 21h8' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		mask-repeat: no-repeat;
		mask-position: center;
		mask-size: contain;
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 21h8' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-position: center;
		-webkit-mask-size: contain;
	}

	:global(.tei-inline-badge-label) {
		line-height: 1;
	}

	:global(.line:has(.marginalia-margin[data-placement="lineLeft"])) {
		padding-left: 7rem;
	}

	:global(.line:has(.marginalia-margin[data-placement="lineRight"])),
	:global(.line:has(.marginalia-margin[data-placement="margin"])) {
		padding-right: 7rem;
	}

	:global(.line:has(.marginalia-interlinear[data-placement="lineAbove"])),
	:global(.line:has(.marginalia-column[data-placement="columnTop"])) {
		padding-top: 2rem;
	}

	:global(.line:has(.marginalia-interlinear[data-placement="lineBelow"])),
	:global(.line:has(.marginalia-column[data-placement="columnBottom"])) {
		padding-bottom: 2.25rem;
	}

	:global(.marginalia-margin[data-placement="lineLeft"]) {
		position: absolute;
		left: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	:global(.marginalia-margin[data-placement="lineRight"]),
	:global(.marginalia-margin[data-placement="margin"]) {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	:global(.marginalia-interlinear[data-placement="lineAbove"]) {
		position: absolute;
		left: 3.25rem;
		top: 0.25rem;
	}

	:global(.marginalia-interlinear[data-placement="lineBelow"]) {
		position: absolute;
		left: 3.25rem;
		bottom: 0.25rem;
	}

	:global(.marginalia-column[data-placement="columnTop"]) {
		position: absolute;
		left: 50%;
		top: 0.25rem;
		transform: translateX(-50%);
		border-style: dashed;
	}

	:global(.marginalia-column[data-placement="columnBottom"]) {
		position: absolute;
		left: 50%;
		bottom: 0.25rem;
		transform: translateX(-50%);
		border-style: dashed;
	}

	:global(.marginalia-inline[data-placement="inline"]),
	:global(.marginalia-inline[data-placement="inSpace"]) {
		opacity: 0.9;
	}

	:global(.frame-grid) {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem;
	}

	:global(.frame-grid > .column[data-zone="top"]),
	:global(.frame-grid > .column[data-zone="bottom"]) {
		flex: 0 0 100%;
	}

	:global(.frame-grid > .column[data-zone="top"]) {
		order: 1;
	}

	:global(.frame-grid > .column[data-zone="left"]) {
		order: 2;
	}

	:global(.frame-grid > .column[data-zone="center"]) {
		order: 3;
	}

	:global(.frame-grid > .column[data-zone="right"]) {
		order: 4;
	}

	:global(.frame-grid > .column[data-zone="bottom"]) {
		order: 5;
	}

	:global(.frame-grid > .column[data-zone="left"]),
	:global(.frame-grid > .column[data-zone="right"]) {
		flex: 1 1 16rem;
	}

	:global(.frame-grid > .column[data-zone="center"]) {
		flex: 2 1 24rem;
	}
</style>
