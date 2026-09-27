import { repairPastedManuscriptSlice } from '$lib/editor/structure';
import { Editor, generateHTML } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { History } from '@tiptap/extension-history';
import { Text } from '@tiptap/extension-text';
import { NodeSelection } from '@tiptap/pm/state';
import {
	Lacunose,
	Unclear,
	WordAttrs,
	Highlight,
	TeiSpan,
	Unconfirmed,
	Damage,
	Surplus,
	Secluded,
	Correction,
	Abbreviation,
	Punctuation,
	PunctuationHighlighter,
	SelectionHighlight,
	markPastedSlice,
} from './marks';
import { TeiMilestoneNode, BookNode, ChapterNode, VerseNode } from './milestone-nodes';
import { PageBreakInline, LineBreakInline, ColumnBreakInline } from './break-nodes';
import { FormWorkNode } from './formwork-node';
import {
	GapNode,
	SpaceNode,
	HandShiftNode,
	MetamarkNode,
	TeiAtomNode,
	TeiWrapperNode,
	CorrectionNode,
	EditorialActionNode,
	UntranscribedNode,
} from './inline-nodes';
import {
	Manuscript,
	Page,
	Column,
	Line,
	MarginaliaDocument,
	MarginaliaColumn,
	MarginaliaLine,
	CorrectionRenderDocument,
} from './structure-nodes';

const SHARED_MARK_EXTENSIONS = [
	Lacunose,
	Unclear,
	WordAttrs,
	Highlight,
	TeiSpan,
	Unconfirmed,
	Damage,
	Surplus,
	Secluded,
	Correction,
	Abbreviation,
	Punctuation,
] as const;

const SHARED_INLINE_NODE_EXTENSIONS = [
	PageBreakInline,
	LineBreakInline,
	ColumnBreakInline,
	GapNode,
	SpaceNode,
	HandShiftNode,
	MetamarkNode,
	TeiAtomNode,
	TeiWrapperNode,
	TeiMilestoneNode,
	CorrectionNode,
	EditorialActionNode,
	UntranscribedNode,
	BookNode,
	ChapterNode,
	VerseNode,
	FormWorkNode,
] as const;

const SHARED_SELECTION_EXTENSIONS = [PunctuationHighlighter, SelectionHighlight] as const;

type EditorProfile = 'main-manuscript' | 'formwork-nested';

interface BaseEditorOptions {
	element: HTMLElement;
	bubbleMenu?: HTMLElement | null;
	className: string;
}

function createBubbleMenuExtension(element: HTMLElement | null | undefined) {
	if (!element) return null;
	return BubbleMenu.configure({
		element,
		tippyOptions: {
			interactive: true,
		},
		shouldShow: (props: any) => {
			const ed = props.editor as Editor;
			const { selection } = ed.state;
			return ed.isFocused && !selection.empty && !(selection instanceof NodeSelection);
		},
	} as any) as any;
}

function getSharedInlineExtensions() {
	return [
		...SHARED_MARK_EXTENSIONS,
		...SHARED_SELECTION_EXTENSIONS,
		...SHARED_INLINE_NODE_EXTENSIONS,
		Text,
	];
}

export function getProfileExtensions(profile: string, bubbleMenu?: HTMLElement | null) {
	const bubbleMenuExtension = createBubbleMenuExtension(bubbleMenu);
	const sharedInlineExtensions = getSharedInlineExtensions();

	if (profile === 'main-manuscript') {
		return [
			History,
			...(bubbleMenuExtension ? [bubbleMenuExtension] : []),
			Manuscript,
			Page,
			Column,
			Line,
			...sharedInlineExtensions,
		];
	}

	if (profile === 'formwork-nested') {
		return [
			History,
			...(bubbleMenuExtension ? [bubbleMenuExtension] : []),
			MarginaliaDocument,
			MarginaliaColumn,
			MarginaliaLine,
			...sharedInlineExtensions,
		];
	}

	throw new Error(`Unknown editor profile: ${profile}`);
}

function createEditorForProfile(profile: EditorProfile, options: BaseEditorOptions) {
	return new Editor({
		element: options.element,
		extensions: getProfileExtensions(profile, options.bubbleMenu),
		editorProps: {
			attributes: {
				class: options.className,
				spellcheck: 'false',
				autocorrect: 'off',
				autocapitalize: 'off',
			},
			...(profile === 'main-manuscript'
				? {
						scrollThreshold: 80,
						scrollMargin: {
							top: 50,
							bottom: 50,
							left: 0,
							right: 0,
						},
						transformPastedText: text => text,
						transformPasted: (slice, view) => {
							const repaired = repairPastedManuscriptSlice(slice, view.state.schema);
							return markPastedSlice(repaired, view.state.schema.marks.unconfirmed);
						},
					}
				: {}),
		},
		parseOptions: {
			preserveWhitespace: 'full',
		},
	});
}

export function getEditor(element: HTMLElement, bubbleMenu: HTMLElement) {
	return createEditorForProfile('main-manuscript', {
		element,
		bubbleMenu,
		className: 'transcription-editor-content',
	});
}

export function getInlineCarrierEditor(element: HTMLElement, bubbleMenu?: HTMLElement | null) {
	return createEditorForProfile('formwork-nested', {
		element,
		bubbleMenu,
		className:
			'inline-carrier-editor-content marginalia-editor-content border rounded p-3 min-h-[132px] text-base font-greek bg-base-50 flex items-start gap-3 overflow-x-auto',
	});
}

export function renderCorrectionContent(content: any): string {
	if (!content || (Array.isArray(content) && content.length === 0)) {
		return '[empty]';
	}

	const correctionExtensions = getCorrectionRenderExtensions();

	try {
		const docContent = {
			type: 'correctionDoc',
			content: Array.isArray(content) ? content : [content],
		};

		return generateHTML(docContent, correctionExtensions);
	} catch (error) {
		console.error('Error rendering correction content:', error);
		return '[error rendering content]';
	}
}

export function getCorrectionRenderExtensions() {
	return [
		CorrectionRenderDocument,
		...SHARED_MARK_EXTENSIONS,
		...SHARED_INLINE_NODE_EXTENSIONS,
		Text,
	];
}
