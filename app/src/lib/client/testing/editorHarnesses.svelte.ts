import type { Editor } from '@tiptap/core';
import { mount, unmount } from 'svelte';

import { initializeEditorContent } from '../editorContentInitialization';
import { getEditor } from '../transcriptionEditorSchema';
import InlineCarrierWorkspace from '../../components/transcriptionEditor/InlineCarrierWorkspace.svelte';
import TranscriptionEditor from '../../components/transcriptionEditor/TranscriptionEditor.svelte';
import {
	editorDocument,
	marginaliaDocument,
	transcriptionDocument,
	type EditorJson,
} from './editorFixtures';

export interface CreateTestEditorOptions {
	content?: EditorJson;
	attach?: boolean;
}

export function createTestEditor(options: CreateTestEditorOptions | EditorJson = {}): Editor {
	const resolved = 'type' in options ? { content: options } : options;
	const element = document.createElement('div');
	const bubbleMenu = document.createElement('div');
	if (resolved.attach) document.body.append(element, bubbleMenu);
	const editor = getEditor(element, bubbleMenu);
	initializeEditorContent(editor, (resolved.content ?? editorDocument({})) as any, {
		emitUpdate: false,
	});
	return editor;
}

export async function waitFor<T>(read: () => T | null, timeoutMs = 4000): Promise<T> {
	const started = performance.now();
	for (;;) {
		const value = read();
		if (value) return value;
		if (performance.now() - started > timeoutMs) throw new Error('waitFor timed out');
		await new Promise(resolve => setTimeout(resolve, 16));
	}
}

export function tick(times = 1): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 30 * times));
}

export function nextAnimationFrame(): Promise<void> {
	return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function placeCaretAtEndOf(element: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection) throw new Error('no selection');
	const range = document.createRange();
	range.selectNodeContents(element);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
	element.closest<HTMLElement>('.ProseMirror')?.focus();
}

export function control(container: ParentNode, ariaLabel: string): HTMLElement {
	const element = container.querySelector<HTMLElement>(`[aria-label="${ariaLabel}"]`);
	if (!element) throw new Error(`no control labelled "${ariaLabel}"`);
	return element;
}

export function lineElement(
	container: ParentNode,
	pageIndex: number,
	columnIndex: number,
	lineIndex: number
): HTMLElement {
	return container
		.querySelectorAll('.page')
		[pageIndex].querySelectorAll('.column')
		[columnIndex].querySelectorAll('.line')[lineIndex] as HTMLElement;
}

export function marginaliaLineElement(
	container: ParentNode,
	columnIndex: number,
	lineIndex: number
): HTMLElement {
	return container
		.querySelectorAll('.marginalia-column')
		[columnIndex].querySelectorAll('.marginalia-line')[lineIndex] as HTMLElement;
}

export interface TranscriptionEditorHarness {
	container: HTMLElement;
	viewport: HTMLElement;
	component: Record<string, any>;
	dispose: () => void;
}

export interface MountTranscriptionEditorOptions {
	document?: ReturnType<typeof transcriptionDocument>;
	id?: string;
	title?: string;
	widthPx?: number;
	data?: any;
	props?: Record<string, any>;
}

export async function mountTranscriptionEditor(
	options: MountTranscriptionEditorOptions = {}
): Promise<TranscriptionEditorHarness> {
	const viewport = document.createElement('div');
	if (options.widthPx !== undefined) {
		viewport.style.width = `${options.widthPx}px`;
		viewport.style.overflowX = 'auto';
	}
	document.body.appendChild(viewport);
	const container = document.createElement('div');
	viewport.appendChild(container);

	const component = mount(TranscriptionEditor, {
		target: container,
		props: {
			transcription: {
				id: options.id ?? 'transcription-editor-spec',
				title: options.title ?? 'spec fixture',
				content_json: options.document ?? transcriptionDocument({}),
				format: 'normalized_ast_v3',
			} as any,
			data: options.data ?? {},
			...options.props,
		},
	}) as Record<string, any>;

	await waitFor(() => container.querySelector('.ProseMirror .page'));
	let disposed = false;
	return {
		container,
		viewport,
		component,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			void unmount(component as any);
			viewport.remove();
		},
	};
}

export interface InlineCarrierWorkspaceHarness {
	container: HTMLElement;
	emitted: unknown[];
	component: Record<string, any>;
	dispose: () => void;
}

export interface MountInlineCarrierWorkspaceOptions {
	initialContent?: EditorJson;
	toolbarIdPrefix?: string;
}

export async function mountInlineCarrierWorkspace(
	options: MountInlineCarrierWorkspaceOptions = {}
): Promise<InlineCarrierWorkspaceHarness> {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const emitted: unknown[] = [];
	const props = $state({
		initialContent: (options.initialContent ?? marginaliaDocument({})) as unknown,
		onChange: (content: unknown) => {
			emitted.push(content);
			props.initialContent = content;
		},
		toolbarIdPrefix: options.toolbarIdPrefix ?? 'inline-carrier-spec',
	});
	const component = mount(InlineCarrierWorkspace, { target: container, props }) as Record<
		string,
		any
	>;
	await waitFor(() => container.querySelector('.marginalia-column'));
	let disposed = false;
	return {
		container,
		emitted,
		component,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			void unmount(component as any);
			container.remove();
		},
	};
}
