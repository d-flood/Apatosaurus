<script lang="ts">
	import { Lacuna, Metamark } from '$lib/icons';
	import { type Editor } from '@tiptap/core';
	import { FileQuestionMark, GitMerge, PenLine, SeparatorHorizontal } from 'lucide-svelte';
	import ArrowUDownRight from 'phosphor-svelte/lib/ArrowUDownRight';
	import BookOpenText from 'phosphor-svelte/lib/BookOpenText';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import FileArrowDownIcon from 'phosphor-svelte/lib/FileArrowDownIcon';
	import Image from 'phosphor-svelte/lib/Image';
	import ListNumbers from 'phosphor-svelte/lib/ListNumbers';
	import Note from 'phosphor-svelte/lib/Note';
	import Paragraph from 'phosphor-svelte/lib/Paragraph';
	import Sidebar from 'phosphor-svelte/lib/Sidebar';
	import TextColumns from 'phosphor-svelte/lib/TextColumns';
	import TextIndent from 'phosphor-svelte/lib/TextIndent';
	import { getMetamarkInsertContext } from './editorCommands';
	import { METAMARK_FUNCTION_OPTIONS } from './metamarkOptions';

	type ToolbarItemKey =
		| 'page-name'
		| 'insert-page'
		| 'insert-line'
		| 'insert-column'
		| 'iiif-workspace'
		| 'untranscribed'
		| 'gap'
		| 'hand-shift'
		| 'marginalia'
		| 'editor-note'
		| 'metamark'
		| 'correction'
		| 'word-wrap'
		| 'paragraph-start'
		| 'milestone'
		| 'export';

	type GroupPosition = 'only' | 'first' | 'middle' | 'last';

	const TOOLBAR_BUTTON_WIDTH_PX = 48;

	interface CursorPosition {
		pageName?: string;
		columnNumber?: number;
		lineNumber?: number;
		book?: string;
		chapter?: string;
		verse?: string;
	}

	interface Props {
		editor: Editor | null;
		idPrefix?: string;
		pageName: string;
		pageNameDuplicate?: boolean;
		hasPage: boolean;
		exportLoading: boolean;
		showPageNameInput?: boolean;
		showInsertPageButton?: boolean;
		showInsertLineButton?: boolean;
		showInsertColumnButton?: boolean;
		showMarginaliaButton?: boolean;
		showIiifWorkspaceButton?: boolean;
		showExportButton?: boolean;
		sticky?: boolean;
		insertColumnTooltip?: string;
		insertColumnTitle?: string;
		insertColumnAriaLabel?: string;
		insertLineTooltip?: string;
		insertLineTitle?: string;
		insertLineAriaLabel?: string;
		cursorPosition?: CursorPosition;
		iiifWorkspaceOpen?: boolean;
		onPageNameChange: (name: string) => void;
		onToggleIiifWorkspace?: () => void;
		onInsertPage: () => void;
		onInsertFramedPage?: () => void;
		onInsertLine?: () => void;
		onInsertColumn: () => void;
		onToggleWordWrapped: () => void;
		onToggleParagraphStart?: () => void;
		onInsertUntranscribed: (reason: string, extent: 'partial' | 'full') => void;
		onInsertGap: (reason: string, unit: string, extent: string) => void;
		onInsertSpace: (unit: string, extent: string) => void;
		onInsertHandShift: (newHand: string, medium: string) => void;
		onInsertEditorNote: (type: string, text: string) => void;
		onInsertMarginalia: () => void;
		onInsertMetamark: (functionValue: string) => void;
		onInsertCorrectionNode: () => void;
		onInsertGenericTeiMilestone: (
			unit: string,
			value: string,
			ed: string,
			event: Event
		) => void;
		onInsertMilestoneNode: (
			type: 'book' | 'chapter' | 'verse',
			value: string,
			event: Event
		) => void;
		onTEIExport: () => void;
	}

	let {
		editor,
		idPrefix = 'editor-toolbar',
		pageName,
		pageNameDuplicate = false,
		hasPage,
		exportLoading,
		showPageNameInput = true,
		showInsertPageButton = true,
		showInsertLineButton = false,
		showInsertColumnButton = true,
		showMarginaliaButton = true,
		showIiifWorkspaceButton = true,
		showExportButton = true,
		sticky = true,
		insertColumnTooltip = 'Insert column',
		insertColumnTitle = 'Insert a new column at the current cursor position',
		insertColumnAriaLabel = 'Insert Column',
		insertLineTooltip = 'Insert line',
		insertLineTitle = 'Insert a new line at the current cursor position',
		insertLineAriaLabel = 'Insert Line',
		cursorPosition,
		iiifWorkspaceOpen = false,
		onPageNameChange,
		onToggleIiifWorkspace,
		onInsertPage,
		onInsertFramedPage,
		onInsertLine,
		onInsertColumn,
		onToggleWordWrapped,
		onToggleParagraphStart,
		onInsertUntranscribed,
		onInsertGap,
		onInsertSpace,
		onInsertHandShift,
		onInsertEditorNote,
		onInsertMarginalia,
		onInsertMetamark,
		onInsertCorrectionNode,
		onInsertGenericTeiMilestone,
		onInsertMilestoneNode,
		onTEIExport,
	}: Props = $props();

	const untranscribedReasons = ['Illegible', 'Damaged', 'Missing', 'Commentary/Secondary Text'];
	let untranscribedExtent = $state<'partial' | 'full'>('partial');

	const gapReasons = ['Damage/Loss', 'Illegible', 'Missing', 'Other'];
	let gapReason = $state('Damage/Loss');
	let gapUnit = $state('');
	let gapExtent = $state('');
	let spaceUnit = $state('chars');
	let spaceExtent = $state('1');
	let handShiftTarget = $state('');
	let handShiftMedium = $state('');
	let noteType = $state('editorial');
	let noteText = $state('');
	let metamarkFunction = $state('');
	let metamarkContext = $state<ReturnType<typeof getMetamarkInsertContext>>(null);

	let bookValue = $state('');
	let chapterValue = $state('');
	let verseValue = $state('');
	let teiMilestoneUnit = $state('');
	let teiMilestoneValue = $state('');
	let teiMilestoneEd = $state('');

	function populateMilestoneValues() {
		if (cursorPosition) {
			bookValue = cursorPosition.book || '';
			chapterValue = cursorPosition.chapter || '';
			verseValue = cursorPosition.verse || '';
		}
	}

	function popoverId(name: string) {
		return `${idPrefix}-${name}`;
	}

	function anchorName(name: string) {
		return `--${idPrefix}-${name}`;
	}

	function inputId(name: string) {
		return `${idPrefix}-${name}`;
	}

	$effect(() => {
		if (!editor) {
			metamarkContext = null;
			return;
		}

		const syncMetamarkContext = () => {
			metamarkContext = getMetamarkInsertContext(editor);
		};

		syncMetamarkContext();
		editor.on('selectionUpdate', syncMetamarkContext);
		editor.on('transaction', syncMetamarkContext);

		return () => {
			editor.off('selectionUpdate', syncMetamarkContext);
			editor.off('transaction', syncMetamarkContext);
		};
	});

	let toolbarRoot = $state<HTMLElement | null>(null);
	let rowCount = $state(1);

	const orderedToolbarItems = $derived.by(() => {
		const items: ToolbarItemKey[] = [];

		if (showPageNameInput && !showInsertPageButton) items.push('page-name');
		if (showInsertPageButton) items.push('insert-page');
		if (showInsertLineButton) items.push('insert-line');
		if (showInsertColumnButton) items.push('insert-column');
		if (showIiifWorkspaceButton) items.push('iiif-workspace');

		items.push('untranscribed', 'gap', 'hand-shift');

		if (showMarginaliaButton) items.push('marginalia');

		items.push('editor-note', 'metamark', 'correction', 'word-wrap');

		if (onToggleParagraphStart) items.push('paragraph-start');

		items.push('milestone');

		if (showExportButton) items.push('export');

		return items;
	});

	function chunkItems<T>(items: T[], groups: number): T[][] {
		if (items.length === 0) return [];
		const normalizedGroups = Math.max(1, Math.min(groups, items.length));
		const baseSize = Math.floor(items.length / normalizedGroups);
		const remainder = items.length % normalizedGroups;
		const chunks: T[][] = [];
		let offset = 0;

		for (let index = 0; index < normalizedGroups; index += 1) {
			const size = baseSize + (index < remainder ? 1 : 0);
			chunks.push(items.slice(offset, offset + size));
			offset += size;
		}

		return chunks;
	}

	function getGroupPosition(index: number, length: number): GroupPosition {
		if (length <= 1) return 'only';
		if (index === 0) return 'first';
		if (index === length - 1) return 'last';
		return 'middle';
	}

	function recalculateRowCount() {
		if (!toolbarRoot || orderedToolbarItems.length === 0) return;

		const availableWidth = toolbarRoot.clientWidth;
		if (availableWidth <= 0) return;

		const buttonsPerRow = Math.max(
			1,
			Math.floor((availableWidth + 1) / TOOLBAR_BUTTON_WIDTH_PX)
		);
		const maxRows = Math.min(4, orderedToolbarItems.length);
		const nextRowCount = Math.min(
			maxRows,
			Math.max(1, Math.ceil(orderedToolbarItems.length / buttonsPerRow))
		);

		rowCount = nextRowCount;
	}

	const groupedToolbarItems = $derived(chunkItems(orderedToolbarItems, rowCount));

	$effect(() => {
		orderedToolbarItems;
		queueMicrotask(() => {
			recalculateRowCount();
		});
	});

	$effect(() => {
		if (!toolbarRoot || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(() => {
			recalculateRowCount();
		});

		observer.observe(toolbarRoot);

		return () => observer.disconnect();
	});
</script>

{#if editor}
	{#snippet renderToolbarItem(item: ToolbarItemKey, position: GroupPosition)}
		{#if item === 'page-name'}
			<input
				data-toolbar-item-key={item}
				data-group-position={position}
				type="text"
				bind:value={pageName}
				oninput={e => onPageNameChange((e.target as HTMLInputElement).value)}
				placeholder="Page name (e.g. 123r)"
				class={['input join-item', pageNameDuplicate && 'input-error']}
			/>
		{:else if item === 'insert-page'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert a new page"
			>
				<button
					popovertarget={popoverId('popover-insert-page')}
					style={`anchor-name: ${anchorName('anchor-insert-page')}`}
					class="btn btn-primary"
					title="Insert a new page"
					aria-label="Insert Page"
				>
					<BookOpenText class="inline-block" size={24} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-insert-page')}
					style={`position-anchor: ${anchorName('anchor-insert-page')}`}
					class="dropdown rounded-box w-56 bg-primary p-3 text-primary-content shadow-sm"
				>
					{#if showPageNameInput}
						<label class="input input-sm mb-2 w-full rounded-field bg-base-100 text-base-content">
							<span class="label text-sm font-medium">Page</span>
							<input
								type="text"
								bind:value={pageName}
								oninput={e => onPageNameChange((e.target as HTMLInputElement).value)}
								placeholder="e.g. 123r"
								aria-invalid={pageNameDuplicate}
							/>
						</label>
						{#if pageNameDuplicate}
							<p class="mb-2 text-xs text-warning">Page names must be unique.</p>
						{/if}
					{/if}
					<button
						onclick={() => {
							onInsertPage();
							const popover = document.getElementById(
								popoverId('popover-insert-page')
							) as HTMLElement & { hidePopover: () => void };
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral mb-1 w-full rounded-field"
						disabled={!pageName.trim() || pageNameDuplicate}
					>
						<BookOpenText size={16} />
						Standard Page
					</button>
					{#if onInsertFramedPage}
						<button
							onclick={() => {
								onInsertFramedPage?.();
								const popover = document.getElementById(
									popoverId('popover-insert-page')
								) as HTMLElement & { hidePopover: () => void };
								if (popover?.hidePopover) popover.hidePopover();
							}}
							class="btn btn-sm btn-neutral w-full rounded-field"
							disabled={!pageName.trim() || pageNameDuplicate}
						>
							<BookOpenText size={16} />
							Framed Page (Catena)
						</button>
					{/if}
				</div>
			</div>
		{:else if item === 'insert-line'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip={insertLineTooltip}
			>
				<button
					onclick={() => onInsertLine?.()}
					class={[
						'btn btn-primary',
						!hasPage && 'border-none bg-primary/40 text-primary-content shadow-none',
					]}
					title={insertLineTitle}
					aria-label={insertLineAriaLabel}
					disabled={!hasPage || !onInsertLine}
				>
					<ListNumbers class="inline-block" size={24} />
				</button>
			</div>
		{:else if item === 'insert-column'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip={insertColumnTooltip}
			>
				<button
					onclick={onInsertColumn}
					class={[
						'btn btn-primary',
						!hasPage && 'border-none bg-primary/40 text-primary-content shadow-none',
					]}
					title={insertColumnTitle}
					aria-label={insertColumnAriaLabel}
					disabled={!hasPage}
				>
					<TextColumns class="inline-block" size={24} />
				</button>
			</div>
		{:else if item === 'iiif-workspace'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Image Workspace"
			>
				<button
					onclick={() => onToggleIiifWorkspace?.()}
					class={['btn', iiifWorkspaceOpen ? 'btn-secondary' : 'btn-primary']}
					title="Image Workspace"
					aria-label="Image Workspace"
				>
					<Image class="inline-block" size={24} />
				</button>
			</div>
		{:else if item === 'untranscribed'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Mark line as untranscribed"
			>
				<button
					popovertarget={popoverId('popover-untranscribed')}
					style={`anchor-name: ${anchorName('anchor-untranscribed')}`}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<FileQuestionMark class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-untranscribed')}
					style={`position-anchor: ${anchorName('anchor-untranscribed')}`}
					class="dropdown rounded-box w-64 bg-primary p-3 text-primary-content shadow-sm"
				>
					<label class="select mb-1 rounded-selector bg-base-100 text-base-content">
						<span class="label">Extent</span>
						<select id={inputId('extent-select')} bind:value={untranscribedExtent}>
							<option value="partial">Partial Line</option>
							<option value="full">Full Line</option>
						</select>
					</label>
					{#each untranscribedReasons as reason}
						<button
							onclick={() => {
								onInsertUntranscribed(reason, untranscribedExtent);
								const popover = document.getElementById(
									popoverId('popover-untranscribed')
								) as HTMLElement & { hidePopover: () => void };
								if (popover?.hidePopover) popover.hidePopover();
							}}
							class="btn btn-sm btn-neutral w-full rounded-field"
						>
							<FileQuestionMark size={16} />
							{reason}
						</button>
					{/each}
				</div>
			</div>
		{:else if item === 'gap'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Lacuna or Blank Space"
			>
				<button
					popovertarget={popoverId('popover-gap')}
					style={`anchor-name: ${anchorName('anchor-gap')}`}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-label="Insert Lacuna"
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<Lacuna class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-gap')}
					style={`position-anchor: ${anchorName('anchor-gap')}`}
					class="dropdown rounded-box w-64 space-y-2 bg-primary p-3 text-primary-content shadow-sm"
				>
					<label class="select rounded-selector bg-base-100 text-base-content">
						<span class="label mb-1 text-sm font-medium">Reason*</span>
						<select id={inputId('gap-reason-select')} bind:value={gapReason}>
							{#each gapReasons as reason}
								<option value={reason}>{reason}</option>
							{/each}
						</select>
					</label>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Unit</span>
						<input
							type="text"
							id={inputId('gap-unit-input')}
							bind:value={gapUnit}
							placeholder="e.g. lines, words, characters"
						/>
					</label>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Extent</span>
						<input
							type="text"
							id={inputId('gap-extent-input')}
							bind:value={gapExtent}
							placeholder="e.g. 3, several, unknown"
						/>
					</label>
					<button
						onclick={() => {
							onInsertGap(gapReason, gapUnit, gapExtent);
							gapReason = 'Damage/Loss';
							gapUnit = '';
							gapExtent = '';
							const popover = document.getElementById(
								popoverId('popover-gap')
							) as HTMLElement & {
								hidePopover: () => void;
							};
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral w-full rounded-field"
					>
						<Lacuna size={16} />
						Insert Lacuna
					</button>
					<div class="divider divider-neutral my-1 text-xs">Blank Space</div>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Unit</span>
						<input
							type="text"
							id={inputId('space-unit-input')}
							bind:value={spaceUnit}
							placeholder="e.g. chars, lines"
						/>
					</label>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Extent</span>
						<input
							type="text"
							id={inputId('space-extent-input')}
							bind:value={spaceExtent}
							placeholder="e.g. 1"
						/>
					</label>
					<button
						onclick={() => {
							onInsertSpace(spaceUnit, spaceExtent);
							spaceUnit = 'chars';
							spaceExtent = '1';
							const popover = document.getElementById(
								popoverId('popover-gap')
							) as HTMLElement & {
								hidePopover: () => void;
							};
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral w-full rounded-field"
					>
						<SeparatorHorizontal size={16} />
						Insert Space
					</button>
				</div>
			</div>
		{:else if item === 'hand-shift'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Change of Scribe"
			>
				<button
					popovertarget={popoverId('popover-hand-shift')}
					style={`anchor-name: ${anchorName('anchor-hand-shift')}`}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-label="Change of Scribe"
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<PenLine class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-hand-shift')}
					style={`position-anchor: ${anchorName('anchor-hand-shift')}`}
					class="dropdown rounded-box w-64 space-y-2 bg-primary p-3 text-primary-content shadow-sm"
				>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Scribe / Hand*</span>
						<input
							type="text"
							id={inputId('hand-shift-target-input')}
							bind:value={handShiftTarget}
							placeholder="e.g. Corrector 1"
						/>
					</label>
					<label class="input rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Medium</span>
						<input
							type="text"
							id={inputId('hand-shift-medium-input')}
							bind:value={handShiftMedium}
							placeholder="Optional"
						/>
					</label>
					<button
						onclick={() => {
							onInsertHandShift(handShiftTarget, handShiftMedium);
							handShiftTarget = '';
							handShiftMedium = '';
							const popover = document.getElementById(
								popoverId('popover-hand-shift')
							) as HTMLElement & { hidePopover: () => void };
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral w-full rounded-field"
						disabled={!handShiftTarget.trim()}
					>
						<PenLine size={16} />
						Change of Scribe
					</button>
				</div>
			</div>
		{:else if item === 'marginalia'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Marginalia"
			>
				<button
					onclick={onInsertMarginalia}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-label="Insert Marginalia"
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<Sidebar class="inline-block rotate-180" size={20} />
				</button>
			</div>
		{:else if item === 'editor-note'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Editor Note"
			>
				<button
					popovertarget={popoverId('popover-note')}
					style={`anchor-name: ${anchorName('anchor-note')}`}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-label="Insert Editor Note"
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<Note class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-note')}
					style={`position-anchor: ${anchorName('anchor-note')}`}
					class="dropdown rounded-box w-72 space-y-2 bg-primary p-3 text-primary-content shadow-sm"
				>
					<label class="select rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Type</span>
						<select id={inputId('note-type-select')} bind:value={noteType}>
							<option value="editorial">Editorial</option>
							<option value="local">Local</option>
						</select>
					</label>
					<label class="form-control">
						<span class="label-text text-sm font-medium">Text</span>
						<textarea
							id={inputId('note-text-input')}
							class="textarea textarea-bordered min-h-24 bg-base-100 text-base-content"
							bind:value={noteText}
							placeholder="Describe the observation"
						></textarea>
					</label>
					<button
						onclick={() => {
							onInsertEditorNote(noteType, noteText);
							noteType = 'editorial';
							noteText = '';
							const popover = document.getElementById(
								popoverId('popover-note')
							) as HTMLElement & { hidePopover: () => void };
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral w-full rounded-field"
						disabled={!noteText.trim()}
					>
						<Note size={16} />
						Insert Note
					</button>
				</div>
			</div>
		{:else if item === 'metamark'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Scribal Mark"
			>
				<button
					popovertarget={popoverId('popover-metamark')}
					style={`anchor-name: ${anchorName('anchor-metamark')}`}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					onmousedown={event => event.preventDefault()}
					aria-label="Insert Scribal Mark"
					aria-disabled={!hasPage}
					disabled={!hasPage}
				>
					<Metamark class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-metamark')}
					style={`position-anchor: ${anchorName('anchor-metamark')}`}
					class="dropdown rounded-box w-64 space-y-2 bg-primary p-3 text-primary-content shadow-sm"
				>
					<label class="select rounded-selector bg-base-100 text-base-content">
						<span class="label text-sm font-medium">Mark Meaning</span>
						<select
							id={inputId('metamark-function-input')}
							bind:value={metamarkFunction}
						>
							<option value="">Select metamark meaning</option>
							{#each METAMARK_FUNCTION_OPTIONS as option}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</label>
					<div class="rounded-selector bg-base-100 px-3 py-2 text-base-content">
						<div class="text-sm font-medium">Applies To</div>
						<div class="text-sm">
							{metamarkContext?.targetLabel ||
								'Select text or choose an editorial action first'}
						</div>
					</div>
					<button
						onmousedown={event => event.preventDefault()}
						onclick={() => {
							onInsertMetamark(metamarkFunction);
							metamarkFunction = '';
							const popover = document.getElementById(
								popoverId('popover-metamark')
							) as HTMLElement & { hidePopover: () => void };
							if (popover?.hidePopover) popover.hidePopover();
						}}
						class="btn btn-sm btn-neutral w-full rounded-field"
						disabled={!metamarkFunction.trim() || !metamarkContext}
					>
						<Metamark size={16} />
						{metamarkContext?.kind === 'text-selection' ? 'Apply Mark' : 'Insert Mark'}
					</button>
				</div>
			</div>
		{:else if item === 'correction'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Scribal Correction"
			>
				<button
					onclick={onInsertCorrectionNode}
					class={[
						'btn btn-primary',
						!hasPage && 'pointer-events-none border-none bg-primary/40 shadow-none',
					]}
					aria-disabled={!hasPage}
					aria-label="Insert Scribal Correction"
					disabled={!hasPage}
					title="Insert a scribal correction"
				>
					<GitMerge class="inline-block" size={20} />
				</button>
			</div>
		{:else if item === 'word-wrap'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Set word as wrapped from previous line"
			>
				<button
					onclick={onToggleWordWrapped}
					class={[
						'btn btn-primary',
						!hasPage && 'border-none bg-primary/40 text-primary-content shadow-none',
					]}
					aria-label="Toggle word wrap continuation"
					disabled={!hasPage}
				>
					<ArrowUDownRight size={24} />
				</button>
			</div>
		{:else if item === 'paragraph-start'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Toggle paragraph start on current line"
			>
				<button
					onclick={onToggleParagraphStart}
					class={[
						'btn btn-primary',
						!hasPage && 'border-none bg-primary/40 text-primary-content shadow-none',
					]}
					aria-label="Toggle paragraph start"
					disabled={!hasPage}
				>
					<TextIndent size={24} />
				</button>
			</div>
		{:else if item === 'milestone'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Insert Book, Chapter, or Verse"
			>
				<button
					popovertarget={popoverId('popover-milestone')}
					style={`anchor-name: ${anchorName('anchor-milestone')}`}
					class="btn btn-primary"
					aria-label="Insert Book, Chapter, or Verse"
				>
					<Paragraph class="inline-block" size={20} />
					<CaretDown class="absolute bottom-0 right-0" size={16} />
				</button>
				<div
					popover
					id={popoverId('popover-milestone')}
					style={`position-anchor: ${anchorName('anchor-milestone')}`}
					class="dropdown rounded-box w-64 space-y-3 bg-primary p-3 text-primary-content shadow-sm"
					onbeforetoggle={e => {
						if ((e as ToggleEvent).newState === 'open') {
							populateMilestoneValues();
						}
					}}
				>
					<!-- Book Section -->
					<div class="space-y-2">
						<label class="block text-sm font-medium" for={inputId('book-input')}
							>Book</label
						>
						<div class="join w-full">
							<input
								type="text"
								id={inputId('book-input')}
								bind:value={bookValue}
								placeholder="e.g. Romans"
								class="input input-sm rounded-s-field text-base-content flex-1"
							/>
							<button
								onclick={e => {
									if (bookValue) {
										onInsertMilestoneNode('book', bookValue, e);
										bookValue = '';
									}
								}}
								class="btn btn-sm btn-neutral shadow-none rounded-e-field"
							>
								<Paragraph size={16} />
								Insert
							</button>
						</div>
					</div>

					<!-- Chapter Section -->
					<div class="space-y-2">
						<label class="block text-sm font-medium" for={inputId('chapter-input')}
							>Chapter (auto-links to preceding book)</label
						>
						<div class="join w-full">
							<input
								type="text"
								id={inputId('chapter-input')}
								bind:value={chapterValue}
								placeholder="e.g. 12"
								class="input input-sm text-base-content rounded-s-field flex-1"
							/>
							<button
								onclick={e => {
									if (chapterValue) {
										onInsertMilestoneNode('chapter', chapterValue, e);
										chapterValue = '';
									}
								}}
								class="btn btn-sm btn-neutral shadow-none rounded-e-field"
							>
								<Paragraph size={16} />
								Insert
							</button>
						</div>
					</div>

					<!-- Verse Section -->
					<div class="space-y-2">
						<label class="block text-sm font-medium" for={inputId('verse-input')}
							>Verse (auto-links to preceding chapter)</label
						>
						<div class="join w-full">
							<input
								type="text"
								id={inputId('verse-input')}
								bind:value={verseValue}
								placeholder="e.g. 1"
								class="input input-sm rounded-s-field text-base-content flex-1"
							/>
							<button
								onclick={e => {
									if (verseValue) {
										onInsertMilestoneNode('verse', verseValue, e);
										verseValue = '';
									}
								}}
								class="btn btn-sm btn-neutral rounded-e-field shadow-none"
							>
								<Paragraph size={16} />
								Insert
							</button>
						</div>
					</div>

					<div class="divider divider-neutral text-xs my-1">Custom Reference Marker</div>
					<div class="space-y-2">
						<label
							class="block text-sm font-medium"
							for={inputId('tei-milestone-unit-input')}>Unit*</label
						>
						<input
							type="text"
							id={inputId('tei-milestone-unit-input')}
							bind:value={teiMilestoneUnit}
							placeholder="e.g. section"
							class="input input-sm rounded-field text-base-content w-full"
						/>
					</div>
					<div class="space-y-2">
						<label
							class="block text-sm font-medium"
							for={inputId('tei-milestone-value-input')}>Value</label
						>
						<input
							type="text"
							id={inputId('tei-milestone-value-input')}
							bind:value={teiMilestoneValue}
							placeholder="e.g. A"
							class="input input-sm rounded-field text-base-content w-full"
						/>
					</div>
					<div class="space-y-2">
						<label
							class="block text-sm font-medium"
							for={inputId('tei-milestone-ed-input')}>Edition</label
						>
						<input
							type="text"
							id={inputId('tei-milestone-ed-input')}
							bind:value={teiMilestoneEd}
							placeholder="Optional edition id"
							class="input input-sm rounded-field text-base-content w-full"
						/>
					</div>
					<button
						onclick={event => {
							if (teiMilestoneUnit.trim()) {
								onInsertGenericTeiMilestone(
									teiMilestoneUnit,
									teiMilestoneValue,
									teiMilestoneEd,
									event
								);
								teiMilestoneUnit = '';
								teiMilestoneValue = '';
								teiMilestoneEd = '';
							}
						}}
						class="btn btn-sm btn-neutral rounded-field w-full"
						disabled={!teiMilestoneUnit.trim()}
					>
						<Paragraph size={16} />
						Insert Reference Marker
					</button>
				</div>
			</div>
		{:else if item === 'export'}
			<div
				data-toolbar-item-key={item}
				data-group-position={position}
				class="tooltip tooltip-neutral tooltip-bottom join-item"
				data-tip="Export as TEI XML"
			>
				<button
					onclick={onTEIExport}
					disabled={exportLoading}
					class="btn btn-primary"
					aria-label="Export as TEI XML"
				>
					<FileArrowDownIcon class="inline-block" size={24} />
					{exportLoading ? 'Exporting...' : ''}
				</button>
			</div>
		{/if}
	{/snippet}

	<div
		bind:this={toolbarRoot}
		class={['z-5 mb-2 flex w-full flex-col items-center gap-2', sticky && 'sticky top-4']}
		id={idPrefix}
	>
		<div class="w-full">
			<div class="flex min-w-fit flex-col items-center gap-2">
				{#each groupedToolbarItems as group}
					<div class="toolbar-join-group join w-max max-w-full justify-center">
						{#each group as item, index}
							{@render renderToolbarItem(item, getGroupPosition(index, group.length))}
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.toolbar-join-group) {
		position: relative;
	}

	:global(.toolbar-join-group:has(> .tooltip:hover)),
	:global(.toolbar-join-group:has(> .tooltip:focus-within)) {
		z-index: 10;
	}

	:global(.toolbar-join-group > .tooltip) {
		position: relative;
	}

	:global(.toolbar-join-group > .tooltip:hover),
	:global(.toolbar-join-group > .tooltip:focus-within),
	:global(.toolbar-join-group > .tooltip:has(:focus-visible)) {
		z-index: 20;
	}

	:global(
		.toolbar-join-group > .join-item[data-group-position='only'],
		.toolbar-join-group > .join-item[data-group-position='only'] > :is(.btn, .input)
	) {
		border-radius: var(--radius-field);
	}

	:global(
		.toolbar-join-group > .join-item[data-group-position='first'],
		.toolbar-join-group > .join-item[data-group-position='first'] > :is(.btn, .input)
	) {
		border-start-start-radius: var(--radius-field);
		border-start-end-radius: 0;
		border-end-end-radius: 0;
		border-end-start-radius: var(--radius-field);
	}

	:global(
		.toolbar-join-group > .join-item[data-group-position='middle'],
		.toolbar-join-group > .join-item[data-group-position='middle'] > :is(.btn, .input)
	) {
		border-radius: 0;
	}

	:global(
		.toolbar-join-group > .join-item[data-group-position='last'],
		.toolbar-join-group > .join-item[data-group-position='last'] > :is(.btn, .input)
	) {
		border-start-start-radius: 0;
		border-start-end-radius: var(--radius-field);
		border-end-end-radius: var(--radius-field);
		border-end-start-radius: 0;
	}
</style>
