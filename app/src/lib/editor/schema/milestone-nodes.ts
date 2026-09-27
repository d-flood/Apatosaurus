import { type BadgeIconName } from '$lib/editor/badge-icons';
import { Node } from '@tiptap/core';
import {
	parseJsonAttr,
	type NodeRenderer,
	inlineBadgeClass,
	iconLabelSpec,
	createIncrementalNodeView,
} from './node-views';

function createTeiAttrAtomNode(
	name: string,
	className: string,
	label: string,
	icon: BadgeIconName
) {
	const renderNode: NodeRenderer = (node, HTMLAttributes) => {
		const teiAttrs = node.attrs.teiAttrs || {};
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass(className),
				'data-tei-attrs': JSON.stringify(teiAttrs),
				title: label,
				contenteditable: 'false',
			},
			...iconLabelSpec(label, icon),
		];
	};
	return Node.create({
		name,
		group: 'inline',
		inline: true,
		atom: true,
		selectable: true,
		parseHTML() {
			return [{ tag: `span.${className}` }];
		},
		renderHTML({ node, HTMLAttributes }) {
			return renderNode(node, HTMLAttributes);
		},
		addNodeView() {
			return createIncrementalNodeView(renderNode);
		},
		addAttributes() {
			return {
				teiAttrs: {
					default: {},
					parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
					renderHTML: attributes => ({
						'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
					}),
				},
			};
		},
	});
}

export const BookNode = Node.create({
	name: 'book',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.book-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		const sourceLabel = node.attrs.sourceLabel;
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('book-milestone', 'select-none mx-1'),
				'data-book': book,
				...(sourceLabel !== null && sourceLabel !== undefined
					? { 'data-source-label': sourceLabel }
					: {}),
				contenteditable: 'false',
			},
			...iconLabelSpec(`${sourceLabel ?? book}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
			sourceLabel: {
				default: null,
				parseHTML: element => element.getAttribute('data-source-label'),
				renderHTML: attributes =>
					attributes.sourceLabel === null || attributes.sourceLabel === undefined
						? {}
						: { 'data-source-label': attributes.sourceLabel },
			},
		};
	},
});

export const ChapterNode = Node.create({
	name: 'chapter',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.chapter-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		const chapter = node.attrs.chapter || '';
		const sourceLabel = node.attrs.sourceLabel;
		const display = sourceLabel ?? chapter;
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('chapter-milestone', 'select-none mx-1'),
				'data-book': book,
				'data-chapter': chapter,
				...(sourceLabel !== null && sourceLabel !== undefined
					? { 'data-source-label': sourceLabel }
					: {}),
				contenteditable: 'false',
			},
			...iconLabelSpec(`${display}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
			chapter: {
				default: '',
				parseHTML: element => element.getAttribute('data-chapter'),
				renderHTML: attributes => ({
					'data-chapter': attributes.chapter,
				}),
			},
			sourceLabel: {
				default: null,
				parseHTML: element => element.getAttribute('data-source-label'),
				renderHTML: attributes =>
					attributes.sourceLabel === null || attributes.sourceLabel === undefined
						? {}
						: { 'data-source-label': attributes.sourceLabel },
			},
		};
	},
});

export const VerseNode = Node.create({
	name: 'verse',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.verse-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		const chapter = node.attrs.chapter || '';
		const verse = node.attrs.verse || '';
		const sourceLabel = node.attrs.sourceLabel;
		let display = verse;
		if (chapter) {
			display = `${chapter}:${verse}`;
		}
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('verse-milestone', 'select-none mx-1'),
				'data-book': book,
				'data-chapter': chapter,
				'data-verse': verse,
				...(sourceLabel !== null && sourceLabel !== undefined
					? { 'data-source-label': sourceLabel }
					: {}),
				contenteditable: 'false',
			},
			...iconLabelSpec(`${sourceLabel ?? display}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
			chapter: {
				default: '',
				parseHTML: element => element.getAttribute('data-chapter'),
				renderHTML: attributes => ({
					'data-chapter': attributes.chapter,
				}),
			},
			verse: {
				default: '',
				parseHTML: element => element.getAttribute('data-verse'),
				renderHTML: attributes => ({
					'data-verse': attributes.verse,
				}),
			},
			sourceLabel: {
				default: null,
				parseHTML: element => element.getAttribute('data-source-label'),
				renderHTML: attributes =>
					attributes.sourceLabel === null || attributes.sourceLabel === undefined
						? {}
						: { 'data-source-label': attributes.sourceLabel },
			},
		};
	},
});
export const TeiMilestoneNode = createTeiAttrAtomNode(
	'teiMilestone',
	'tei-milestone-node',
	'milestone',
	'milestone'
);
