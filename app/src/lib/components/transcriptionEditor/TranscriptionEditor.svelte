<script lang="ts">
	import { updateTranscriptionContent } from '$lib/client/db/client';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { fromProseMirror, toProseMirror } from '$lib/tei/tei-transcription';
	import { syncVerseIndexFromDocument } from '$lib/client/transcription/verse-index';
	import {
		coerceTranscriptionDocument,
		EMPTY_TRANSCRIPTION_DOC,
		serializeTranscriptionDocument,
		TRANSCRIPTION_FORMAT,
		type StoredTranscriptionDocument,
	} from '$lib/client/transcription/content';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import { getEditor } from '$lib/client/transcriptionEditorSchema';
	import { initializeEditorContent } from '$lib/client/editorContentInitialization';
	import {
		createColumnSplitTransaction,
		prepareManuscriptDocumentEntry,
	} from '$lib/client/transcriptionEditorStructure';
	import { exportTEIDocument } from '$lib/tei/tei-exporter';
	import { Editor } from '@tiptap/core';
	import { NodeSelection, TextSelection, type EditorState } from '@tiptap/pm/state';
	import {
		autoUpdate,
		computePosition,
		flip,
		offset as floatingOffset,
		shift,
	} from '@floating-ui/dom';
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
		updateNodeAttrs,
	} from './editorCommands';
	import {
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
		captureAbbreviationTarget,
		captureCorrectionTarget,
		DEFAULT_INSPECTOR_CARRIER_TYPES,
		getSelectedTranscriptionQuote,
		getSelectedInspectorNode,
		inspectorSelectionKey,
		readAbbreviationDraft,
		readCorrectionDraft,
		removeAbbreviationMark,
		removeCorrectionMark,
		type TextMarkTarget,
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
		scrollToVerseRequest?: {
			book: string;
			chapter: string;
			verse: string;
			token: string;
		} | null;
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
	let stackColumns = $state(false);

	let hasPage = $state(false);
	let canonicalDocument = $state<StoredTranscriptionDocument>(EMPTY_TRANSCRIPTION_DOC);

	interface CursorPosition {
		pageName?: string;
		column?: number;
		line?: number;
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
	let correctionTarget = $state<TextMarkTarget | null>(null);

	// Abbreviation mark editing state
	let abbrType = $state('nomSac');
	let abbrExpansion = $state('');
	let abbrRend = $state('\u00AF');
	let abbreviationTarget = $state<TextMarkTarget | null>(null);

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

	function normalizePageName(name: string | null | undefined): string {
		return name?.trim().toLowerCase() ?? '';
	}

	function findPageById(doc: any, pageId: string): { node: any; pos: number } | null {
		let found: { node: any; pos: number } | null = null;
		doc.forEach((node: any, pos: number) => {
			if (!found && node.type.name === 'page' && node.attrs.pageId === pageId) {
				found = { node, pos };
			}
		});
		return found;
	}

	function pageNameExists(name: string, excludedPageId?: string): boolean {
		const normalizedName = normalizePageName(name);
		if (!normalizedName) return false;

		const editor = editorState.editor;
		if (!editor) {
			return pages.some(
				page =>
					page.pageId !== excludedPageId &&
					normalizePageName(page.pageName) === normalizedName
			);
		}

		let duplicateFound = false;
		editor.state.doc.descendants(node => {
			if (node.type.name !== 'page' || node.attrs.pageId === excludedPageId) {
				return true;
			}

			if (normalizePageName(node.attrs.pageName) === normalizedName) {
				duplicateFound = true;
				return false;
			}

			return true;
		});

		return duplicateFound;
	}

	const pageNameDuplicate = $derived(pageNameExists(pageName));
	// Helper function to check if document has pages
	function checkForPages(editor: Editor | null): boolean {
		return (editor?.state.doc.childCount ?? 0) > 0;
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
		const target = captureCorrectionTarget(editorState.editor);
		if (draft === null || !target) return;
		correctionDraftCorrections = draft;
		correctionTarget = target;

		drawerMode = 'correction';
	}

	function applyCorrectionFromDrawer(corrections: Correction[]) {
		applyCorrectionMark(editorState.editor, correctionTarget, corrections);
		correctionTarget = null;
		drawerMode = 'inspector';
	}

	function removeCorrectionFromDrawer() {
		removeCorrectionMark(editorState.editor, correctionTarget);
		correctionTarget = null;
		drawerMode = 'inspector';
	}

	function openAbbreviationDrawer() {
		const draft = readAbbreviationDraft(editorState.editor);
		const target = captureAbbreviationTarget(editorState.editor);
		if (!draft || !target) return;
		abbrType = draft.type;
		abbrExpansion = draft.expansion;
		abbrRend = draft.rend;
		abbreviationTarget = target;

		drawerMode = 'abbreviation';
	}

	function applyAbbreviationFromDrawer() {
		if (
			!applyAbbreviationMark(editorState.editor, abbreviationTarget, {
				type: abbrType,
				expansion: abbrExpansion,
				rend: abbrRend,
			})
		) {
			abbreviationTarget = null;
			drawerMode = 'inspector';
			return;
		}
		abbreviationTarget = null;
		drawerMode = 'inspector';
	}

	function removeAbbreviationFromDrawer() {
		removeAbbreviationMark(editorState.editor, abbreviationTarget);
		abbreviationTarget = null;
		drawerMode = 'inspector';
	}

	function scrollSelectedNodeAboveDrawer() {
		if (!editorState.editor) return;
		const { view } = editorState.editor;
		const domAtPos = view.domAtPos(view.state.selection.from);
		const selectedElement =
			domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement;
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

	function editorTooltips(node: HTMLElement) {
		const tooltip = document.createElement('div');
		tooltip.dataset.transcriptionTooltip = '';
		tooltip.role = 'tooltip';
		tooltip.hidden = true;
		tooltip.className =
			'pointer-events-none fixed z-[100] max-w-xs rounded-sm bg-neutral px-2 py-1 text-xs font-medium text-neutral-content shadow-lg';
		document.body.appendChild(tooltip);

		let activeTrigger: HTMLElement | null = null;
		let stopPositioning: (() => void) | null = null;

		const hide = (event?: MouseEvent | FocusEvent) => {
			if (!activeTrigger) return;
			const nextTarget = event?.relatedTarget;
			if (nextTarget instanceof Node && activeTrigger.contains(nextTarget)) return;

			activeTrigger = null;
			stopPositioning?.();
			stopPositioning = null;
			tooltip.hidden = true;
			tooltip.style.visibility = 'hidden';
		};
		const show = (event: MouseEvent | FocusEvent) => {
			if (!(event.target instanceof Element)) return;
			const trigger = event.target.closest<HTMLElement>('.tooltip[data-tip]');
			const text = trigger?.dataset.tip;
			if (!trigger || !text || !node.contains(trigger) || trigger === activeTrigger) return;

			stopPositioning?.();
			activeTrigger = trigger;
			tooltip.textContent = text;
			tooltip.hidden = false;
			tooltip.style.visibility = 'hidden';
			stopPositioning = autoUpdate(trigger, tooltip, () => {
				void computePosition(trigger, tooltip, {
					placement: 'top',
					strategy: 'fixed',
					middleware: [floatingOffset(8), flip(), shift({ padding: 8 })],
				}).then(({ x, y }) => {
					if (activeTrigger !== trigger || !tooltip.isConnected) return;
					tooltip.style.left = `${x}px`;
					tooltip.style.top = `${y}px`;
					tooltip.style.visibility = 'visible';
				});
			});
		};
		node.addEventListener('mouseover', show);
		node.addEventListener('mouseout', hide);
		node.addEventListener('focusin', show);
		node.addEventListener('focusout', hide);

		return {
			destroy() {
				node.removeEventListener('mouseover', show);
				node.removeEventListener('mouseout', hide);
				node.removeEventListener('focusin', show);
				node.removeEventListener('focusout', hide);
				stopPositioning?.();
				tooltip.remove();
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

	function updatePageName(pageId: string, newName: string): boolean {
		if (!editorState.editor) return false;
		if (pageNameExists(newName, pageId)) return false;

		editorState.editor
			.chain()
			.command(({ tr, state }) => {
				const page = findPageById(state.doc, pageId);
				if (!page) return false;
				tr.setNodeMarkup(page.pos, undefined, {
					...page.node.attrs,
					pageName: newName.trim() || null,
				});
				return true;
			})
			.run();

		return true;
	}

	function deletePage(pageId: string) {
		const editor = editorState.editor;
		if (!editor) return;

		editor
			.chain()
			.command(({ tr, state }) => {
				const page = findPageById(state.doc, pageId);
				if (!page) return false;

				tr.delete(page.pos, page.pos + page.node.nodeSize);
				return true;
			})
			.run();
	}

	function updatePageFormWork(
		pageId: string,
		kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature',
		newText: string
	) {
		if (!editorState.editor) return;

		const nextContent = buildPlainTextFormWorkContent(newText);

		editorState.editor
			.chain()
			.command(({ tr, state }) => {
				const page = findPageById(state.doc, pageId);
				if (!page) return false;
				const pageMetadata = extractPageMetadata(page.node, page.pos);
				const existing =
					kind === 'pageLabel'
						? pageMetadata.pageLabel
						: kind === 'runningTitle'
							? pageMetadata.runningTitle
							: kind === 'catchword'
								? pageMetadata.catchword
								: pageMetadata.quireSignature;
				if (existing?.pos) {
					if (nextContent.length === 0) {
						const node = state.doc.nodeAt(existing.pos);
						if (node) {
							tr.delete(existing.pos, existing.pos + node.nodeSize);
						}
						return true;
					}

					const node = state.doc.nodeAt(existing.pos);
					if (node?.type.name === 'fw') {
						tr.replaceWith(
							existing.pos + 1,
							existing.pos + node.nodeSize - 1,
							nextContent.map(child => state.schema.nodeFromJSON(child))
						);
					}
					return true;
				}

				if (nextContent.length === 0) {
					return true;
				}

				const pageNode = page.node;

				const insertPos = findFirstLineInsertPos(pageNode, page.pos);
				if (insertPos === null) {
					return false;
				}

				const formWorkNode = state.schema.nodes.fw?.create(
					createDefaultFormWorkAttrs(kind),
					nextContent.map(child => state.schema.nodeFromJSON(child))
				);
				if (!formWorkNode) {
					return false;
				}

				tr.insert(insertPos, formWorkNode);
				return true;
			})
			.run();
	}

	function insertMarginalia() {
		if (!editorState.editor) return;

		const attrs = createDefaultMarginaliaAttrs('Marginal');
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
			void ensureLocalDbRuntime().catch(error => {
				console.error('[Autosave] Runtime init failed:', error);
			});
			const editor = getEditor(transcriptionElement, bubbleMenu);
			const initialDocument =
				coerceTranscriptionDocument(transcription.content_json) ?? EMPTY_TRANSCRIPTION_DOC;
			canonicalDocument = initialDocument;
			const initialPm = toProseMirror(initialDocument) as any;
			const repairResult = prepareManuscriptDocumentEntry(initialPm);
			if (repairResult.repaired && repairResult.issues.length > 0) {
				console.warn(
					'[Transcription] Repaired invalid manuscript content during editor init:',
					repairResult.issues
				);
			}
			initializeEditorContent(editor, repairResult.doc, { emitUpdate: false });

			// Set editor state once (not on every transaction)
			editorState.editor = editor;
			if (repairResult.repaired) {
				onSaveStateChange?.(false);
				debouncedSyncVerseIndex();
				debouncedAutosave();
			}

			// Performance optimization: Only track structural changes, not every edit
			editor.on('update', ({ transaction }: { transaction: any }) => {
				if (transaction.docChanged) {
					onSaveStateChange?.(false);
					const pageCountChanged =
						transaction.before.childCount !== transaction.doc.childCount;
					pagesNeedUpdate = true;
					if (pageCountChanged) {
						rebuildPageList();
						pagesNeedUpdate = false;
					}
					if (pageCountChanged) hasPage = checkForPages(editor);
					debouncedSyncVerseIndex();
					debouncedAutosave();
				}
				updateSelectionDerivedState(editor);
			});

			// Update cursor position when selection changes (for cursor movement without content changes)
			editor.on('selectionUpdate', () => {
				updateSelectionDerivedState(editor);
			});

			// Initialize hasPage and pages on mount
			hasPage = checkForPages(editor);
			rebuildPageList();
			debouncedSyncVerseIndex();
			updateSelectionDerivedState(editor);

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
					cancelVerseIndexSync();
					void flushAutosave();
					editor.destroy();
					modal.removeEventListener('toggle', handleModalToggle);
					document.removeEventListener('visibilitychange', handleVisibilityChange);
					window.removeEventListener('beforeunload', handleBeforeUnload);
				};
			}

			return () => {
				cancelVerseIndexSync();
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
			insertSelectableCarrierNode(editorState.editor, 'untranscribed', {
				reason,
				extent: 'partial',
			});
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
		insertSelectableCarrierNode(
			editorState.editor,
			'correctionNode',
			buildCorrectionNodeAttrs()
		);
	}

	function toggleWordWrapped() {
		const editor = editorState.editor;
		if (!editor) return;
		const { state, view } = editor;
		const from = state.selection.$from;
		for (let depth = from.depth; depth > 0; depth -= 1) {
			const formWork = from.node(depth);
			if (formWork.type.name !== 'fw') continue;
			let offset = 0;
			let lineBreakPos: number | null = null;
			for (let index = 0; index < from.index(depth); index += 1) {
				const child = formWork.child(index);
				if (child.type.name === 'lineBreak') {
					lineBreakPos = from.before(depth) + 1 + offset;
				}
				offset += child.nodeSize;
			}
			if (lineBreakPos !== null) {
				const lineBreak = state.doc.nodeAt(lineBreakPos);
				const teiAttrs = { ...(lineBreak?.attrs.teiAttrs || {}) };
				if (teiAttrs.break === 'no') delete teiAttrs.break;
				else teiAttrs.break = 'no';
				view.dispatch(
					state.tr.setNodeMarkup(lineBreakPos, undefined, {
						...lineBreak?.attrs,
						teiAttrs,
					})
				);
			}
			return;
		}
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

	/**
	 * Where a new top-level `page` node belongs.
	 *
	 * A page is a top-level node, so its insert point is a property of the
	 * document, never of the selection: the end of the page containing the caret,
	 * or the end of the document when the caret is not inside a page — which is
	 * the case for an editor that has not yet been clicked into. Deriving it from
	 * `state.selection` (what `insertContent` does) let ProseMirror's fitter
	 * resolve the block/inline mismatch by replacing the entire manuscript. See
	 * `.tracker/refactor-transcription-editor/INVENTORY.md` F6.
	 */
	function pageInsertPosition(state: EditorState): number {
		const resolvedFrom = state.selection.$from;
		for (let depth = resolvedFrom.depth; depth > 0; depth--) {
			if (resolvedFrom.node(depth).type.name === 'page') return resolvedFrom.after(depth);
		}
		return state.doc.content.size;
	}

	/** Insert a page built from `pageJson` at a document-derived position. */
	function insertPageNode(editor: Editor, pageJson: Record<string, any>) {
		const { state, view } = editor;
		const insertAt = pageInsertPosition(state);
		const pageNode = state.schema.nodeFromJSON(pageJson);
		const tr = state.tr.insert(insertAt, pageNode);
		// Put the caret in the new page's first line rather than at the end of the
		// document — the two differ whenever the caret was in a middle page.
		tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 3)));
		view.dispatch(tr);

		// Performance optimization: set hasPage instead of checking the whole document
		hasPage = true;
		editor.commands.focus();
		pageName = '';
	}

	function insertPage() {
		const editor = editorState.editor;
		if (!editor || pageNameExists(pageName)) return;

		insertPageNode(editor, {
			type: 'page',
			attrs: { pageId: createEditorPageId(), pageName: pageName || null },
			content: [
				{
					type: 'column',
					attrs: { columnId: createEditorNodeId('col') },
					content: [
						{
							type: 'line',
							attrs: { lineId: createEditorNodeId('line') },
						},
					],
				},
			],
		});
	}

	function insertFramedPage() {
		const editor = editorState.editor;
		if (!editor || pageNameExists(pageName)) return;

		const zones = ['top', 'left', 'right', 'bottom', 'center'] as const;
		const columns = zones.map(zone => ({
			type: 'column',
			attrs: { zone, columnId: createEditorNodeId('col') },
			content: [{ type: 'line', attrs: { lineId: createEditorNodeId('line') } }],
		}));

		insertPageNode(editor, {
			type: 'page',
			attrs: { pageId: createEditorPageId(), pageName: pageName || null },
			content: columns,
		});
	}

	function insertColumn() {
		const editor = editorState.editor;
		const { state, view } = editor || {};
		if (!state || !view) return;
		for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
			if (state.selection.$from.node(depth).type.name === 'fw') {
				insertSelectableCarrierNode(editor, 'columnBreak', { teiAttrs: {} });
				return;
			}
		}

		const tr = createColumnSplitTransaction(state);
		if (!tr) return;

		view.dispatch(tr);
	}

	function getCurrentCursorPosition(): CursorPosition {
		const editor = editorState.editor;
		if (!editor) return {};

		const result: CursorPosition = {};
		const { state } = editor;
		const resolvedFrom = state.selection.$from;

		let lineDepth = -1;
		let columnDepth = -1;
		for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
			const node = resolvedFrom.node(depth);
			if (node.type.name === 'page') result.pageName = node.attrs.pageName || undefined;
			if (columnDepth === -1 && node.type.name === 'column') columnDepth = depth;
			if (lineDepth === -1 && node.type.name === 'line') {
				lineDepth = depth;
			}
		}
		if (lineDepth !== -1) {
			result.line = resolvedFrom.index(lineDepth - 1) + 1;
		}
		if (columnDepth !== -1) {
			result.column = resolvedFrom.index(columnDepth - 1) + 1;
		}

		// Get milestone values (book, chapter, verse)
		const milestones = getCurrentMilestoneValues(editor);
		result.book = milestones.book;
		result.chapter = milestones.chapter;
		result.verse = milestones.verse;

		return result;
	}

	function updateSelectionDerivedState(editor: Editor | null) {
		cursorPosition = getCurrentCursorPosition();
		updateActivePageSelection(editor);
		updateSelectedTeiNode(editor);
		updateSelectedTextQuote(editor);
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

		const sync = () => {
			if (!transcription?.id) return;
			const editorJson = editorState.editor?.getJSON();
			if (!editorJson) return;
			const document = coerceEditorJsonToDocument(editorJson);
			if (!document) return;
			syncVerseIndexFromDocument(transcription.id, document).catch((error: unknown) => {
				console.error('[Verse Index] Failed to sync verse index:', error);
			});
		};

		const cancel = () => {
			if (timeoutId === null) return;
			clearTimeout(timeoutId);
			timeoutId = null;
		};

		const schedule = () => {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			timeoutId = setTimeout(() => {
				timeoutId = null;
				sync();
			}, delayMs);
		};

		return {
			schedule,
			cancel,
			flush: () => {
				if (timeoutId === null) return;
				cancel();
				sync();
			},
		};
	}

	function createDebouncedAutosave(delayMs: number = 1000) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let pendingSave = false;
		let saveInFlight: Promise<boolean> | null = null;

		const persist = async (document: StoredTranscriptionDocument) => {
			const currentTranscription = transcription;
			if (!currentTranscription?.id) return false;
			try {
				const now = new Date().toISOString();
				await ensureLocalDbRuntime();
				await updateTranscriptionContent({
					id: currentTranscription.id,
					document,
					contentJson: serializeTranscriptionDocument(document),
					format: TRANSCRIPTION_FORMAT,
					updatedAt: now,
				});
				canonicalDocument = document;
				return true;
			} catch (error) {
				console.error('[Autosave] Failed to persist transcription content:', error);
				return false;
			}
		};

		async function persistNextDocument(
			document: StoredTranscriptionDocument
		): Promise<boolean> {
			saveInFlight = persist(document);
			try {
				return await saveInFlight;
			} finally {
				saveInFlight = null;
			}
		}

		const flush = async (): Promise<boolean> => {
			let saved = true;
			if (saveInFlight) {
				saved = await saveInFlight;
			}
			while (pendingSave) {
				pendingSave = false;
				const editorJson = editorState.editor?.getJSON();
				if (!editorJson) {
					saved = false;
					break;
				}
				const nextDocument = coerceEditorJsonToDocument(editorJson);
				if (!nextDocument) {
					saved = false;
					break;
				}
				const nextDocumentSaved = await persistNextDocument(nextDocument);
				saved = nextDocumentSaved;
				if (!nextDocumentSaved) {
					pendingSave = true;
					break;
				}
				if (saveInFlight) {
					saved = await saveInFlight;
				}
			}
			if (saved && !pendingSave && !saveInFlight) {
				onSaveStateChange?.(true);
			}
			return saved && !pendingSave && !saveInFlight;
		};

		const schedule = () => {
			pendingSave = true;
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
				return flush();
			},
		};
	}

	const verseIndexSync = createDebouncedVerseIndexSync();
	const debouncedSyncVerseIndex = verseIndexSync.schedule;
	const cancelVerseIndexSync = verseIndexSync.cancel;
	const autosave = createDebouncedAutosave();
	const debouncedAutosave = autosave.schedule;
	const flushAutosave = autosave.flush;

	export function flushPendingAutosave(): Promise<boolean> {
		return flushAutosave();
	}

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
				throw new Error(
					'Failed to convert editor content to canonical transcription document'
				);
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
		if (!updateNodeAttrs(editorState.editor, pos, attrs)) return;

		updateSelectedTeiNode(editorState.editor);
	}

	function getVerticalScrollHost(node: HTMLElement | null): HTMLElement | Window {
		let current = node?.parentElement ?? null;
		while (current) {
			const style = window.getComputedStyle(current);
			if (
				(style.overflowY === 'auto' ||
					style.overflowY === 'scroll' ||
					style.overflowY === 'overlay') &&
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
					: rect.top +
						window.scrollY -
						Math.max((viewportHeight - rect.height) / 2, 0) -
						offset;
			window.scrollTo({ top: Math.max(0, top), behavior: options.behavior });
			return;
		}

		const hostRect = host.getBoundingClientRect();
		const top =
			options.block === 'start'
				? host.scrollTop + (rect.top - hostRect.top) - offset
				: host.scrollTop +
					(rect.top - hostRect.top) -
					Math.max((host.clientHeight - rect.height) / 2, 0) -
					offset;
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

		return (
			milestoneNode.closest<HTMLElement>('.line, .marginalia-line, .line-content') ??
			milestoneNode
		);
	}

	$effect(() => {
		if (!scrollToPageRequest || scrollToPageRequest.token === lastScrollToPageToken) {
			return;
		}
		lastScrollToPageToken = scrollToPageRequest.token;
		requestAnimationFrame(() => {
			const pageNodes =
				transcriptionElement?.querySelectorAll<HTMLElement>('[data-page-id]') || [];
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
			const verseNodes =
				transcriptionElement?.querySelectorAll<HTMLElement>('[data-verse]') || [];
			const milestoneTarget = Array.from(verseNodes).find(
				node =>
					node.dataset.book === scrollToVerseRequest.book &&
					node.dataset.chapter === scrollToVerseRequest.chapter &&
					node.dataset.verse === scrollToVerseRequest.verse
			);
			if (!milestoneTarget) return;

			const target = findVerseContentAnchor(milestoneTarget);

			const targetPage = target.closest<HTMLElement>('[data-page-id]');
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
					}, 150);
				});
			});
		});
	});
</script>

<div class="relative flex flex-col items-center">
	{#if editorState.editor}
		<div use:portal={toolbarTarget} class="w-full">
			<EditorToolbar
				editor={editorState.editor}
				idPrefix="main-editor-toolbar"
				{pageName}
				{pageNameDuplicate}
				{hasPage}
				{exportLoading}
				{cursorPosition}
				{iiifWorkspaceOpen}
				sticky={!toolbarTarget}
				onPageNameChange={name => (pageName = name)}
				{onToggleIiifWorkspace}
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
		use:editorTooltips
		bind:this={transcriptionElement}
		class="prose max-w-none w-full overflow-visible"
		class:stack-columns={stackColumns}
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
	title={drawerMode === 'inspector' && selectedTeiNode
		? getNodeLabel(selectedTeiNode)
		: drawerMode === 'correction'
			? 'Scribal Corrections'
			: 'Abbreviation'}
	onClose={dismissInspectorPanel}
>
	{#if drawerMode === 'inspector' && selectedTeiNode && inspectorPanelOpen}
		<TeiNodeInspector
			selectedNode={selectedTeiNode}
			onUpdateNodeAttrs={updateCarrierNodeAttrs}
		/>
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
		bind:stackColumns
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
		width: 100%;
		min-width: 0;
		container-type: inline-size;
	}

	:global(.column) {
		overflow: visible;
		position: relative;
		min-width: 0;
	}

	:global(.line) {
		overflow-x: auto;
		position: relative;
		scrollbar-width: thin;
	}

	:global(.line::-webkit-scrollbar) {
		height: 4px;
	}

	:global(.line::-webkit-scrollbar-button) {
		display: none;
		width: 0;
		height: 0;
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
		flex: 1 1 0%;
		min-width: 0;
	}

	:global(.ProseMirror .tooltip[data-tip]::before),
	:global(.ProseMirror .tooltip[data-tip]::after) {
		display: none;
	}

	:global(.tei-inline-badge) {
		vertical-align: middle;
	}

	:global(.tei-inline-badge-icon) {
		flex: none;
	}

	:global(.tei-atom-node[data-tag='note']) {
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

	:global(.line:has(.marginalia-margin[data-placement='lineLeft'])) {
		padding-left: 7rem;
	}

	:global(.line:has(.marginalia-margin[data-placement='lineRight'])),
	:global(.line:has(.marginalia-margin[data-placement='margin'])) {
		padding-right: 7rem;
	}

	:global(.line:has(.marginalia-interlinear[data-placement='lineAbove'])),
	:global(.line:has(.marginalia-column[data-placement='columnTop'])) {
		padding-top: 2rem;
	}

	:global(.line:has(.marginalia-interlinear[data-placement='lineBelow'])),
	:global(.line:has(.marginalia-column[data-placement='columnBottom'])) {
		padding-bottom: 2.25rem;
	}

	:global(.marginalia-margin[data-placement='lineLeft']) {
		position: absolute;
		left: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	:global(.marginalia-margin[data-placement='lineRight']),
	:global(.marginalia-margin[data-placement='margin']) {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	:global(.marginalia-interlinear[data-placement='lineAbove']) {
		position: absolute;
		left: 3.25rem;
		top: 0.25rem;
	}

	:global(.marginalia-interlinear[data-placement='lineBelow']) {
		position: absolute;
		left: 3.25rem;
		bottom: 0.25rem;
	}

	:global(.marginalia-column[data-placement='columnTop']) {
		position: absolute;
		left: 50%;
		top: 0.25rem;
		transform: translateX(-50%);
		border-style: dashed;
	}

	:global(.marginalia-column[data-placement='columnBottom']) {
		position: absolute;
		left: 50%;
		bottom: 0.25rem;
		transform: translateX(-50%);
		border-style: dashed;
	}

	:global(.marginalia-inline[data-placement='inline']),
	:global(.marginalia-inline[data-placement='inSpace']) {
		opacity: 0.9;
	}

	:global(.frame-grid:has(> .column[data-zone])) {
		display: grid;
		grid-template-areas:
			'top top top'
			'left center right'
			'bottom bottom bottom';
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
		align-items: flex-start;
		gap: 0.5rem;
	}

	:global(.frame-grid:has(> .column[data-zone]) > .column[data-zone='top']) {
		grid-area: top;
	}

	:global(.frame-grid:has(> .column[data-zone]) > .column[data-zone='left']) {
		grid-area: left;
	}

	:global(.frame-grid:has(> .column[data-zone]) > .column[data-zone='center']) {
		grid-area: center;
	}

	:global(.frame-grid:has(> .column[data-zone]) > .column[data-zone='right']) {
		grid-area: right;
	}

	:global(.frame-grid:has(> .column[data-zone]) > .column[data-zone='bottom']) {
		grid-area: bottom;
	}

	:global(.stack-columns .frame-grid),
	:global(.stack-columns .frame-grid:has(> .column[data-zone])) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}

	:global(.stack-columns .frame-grid > .column) {
		width: 100%;
		flex: none;
	}

	@container (max-width: 44rem) {
		:global(.frame-grid:has(> .column[data-zone])) {
			grid-template-areas: 'top' 'left' 'center' 'right' 'bottom';
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
