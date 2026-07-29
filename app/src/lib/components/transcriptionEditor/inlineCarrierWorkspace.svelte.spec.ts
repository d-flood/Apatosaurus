import { page } from '@vitest/browser/context';
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import {
	control,
	createTestEditor,
	mountTranscriptionEditor,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';
import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '$lib/tei/tei-transcription';

import InspectorTestHarness from './InspectorTestHarness.svelte';

const browserPage = page as any;

function wrapInTei(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>${body}</body></text></TEI>`;
}

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

function formWorkPosition(editor: any): number {
	let position = -1;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (position === -1 && node.type.name === 'fw') position = pos;
		return position === -1;
	});
	if (position === -1) throw new Error('no fw node');
	return position;
}

function formWorkNode(editor: any): any {
	return editor.state.doc.nodeAt(formWorkPosition(editor));
}

describe('formwork content in the main editor', () => {
	it('preserves rich content when the inspector edits metadata', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/><fw type="header"><foreign xml:lang="la"><w>x<lb break="no"/>y</w></foreign><app><rdg type="orig"><w>alpha</w></rdg><rdg type="corr" hand="c2"><w>beta</w></rdg></app></fw>'
			),
		});

		await browserPage.getByTestId('select-fw').click();
		await browserPage.getByLabelText('Appearance').fill('center');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		expect(document.querySelector('.inline-carrier-editor-input')).toBeNull();
		const exported = browserPage.getByTestId('exported-xml').element().textContent || '';
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw type="header" rend="center"><foreign xml:lang="la"><w>x<lb break="no"/>y</w></foreign><app><rdg type="orig"><w>alpha</w></rdg><rdg type="corr" hand="c2"><w>beta</w></rdg></app></fw>'
			)
		);
	});

	it('edits and searches fw text as part of the main document and undoes the typing group', () => {
		const editor = createTestEditor({
			content: toProseMirror(
				parseTei(
					wrapInTei('<pb n="1r"/><cb n="1"/><lb/><fw type="header"><w>alpha</w></fw>')
				)
			) as any,
		});

		try {
			const contentStart = formWorkPosition(editor) + 1;
			editor.view.dispatch(
				editor.state.tr.setSelection(
					TextSelection.create(editor.state.doc, contentStart + 5)
				)
			);
			editor.commands.insertContent('b');
			editor.commands.insertContent('c');

			expect(formWorkNode(editor).textContent).toBe('alphabc');
			expect(editor.state.doc.textContent).toContain('alphabc');
			expect(editor.commands.undo()).toBe(true);
			expect(formWorkNode(editor).textContent).toBe('alpha');
		} finally {
			editor.destroy();
		}
	});

	it('persists a mark applied inside fw content through save and reload', () => {
		const content = toProseMirror(
			parseTei(wrapInTei('<pb n="1r"/><cb n="1"/><lb/><fw type="header"><w>alpha</w></fw>'))
		) as any;
		const editor = createTestEditor({ content });
		let reloaded: ReturnType<typeof createTestEditor> | null = null;

		try {
			const contentStart = formWorkPosition(editor) + 1;
			editor.commands.setTextSelection({ from: contentStart, to: contentStart + 5 });
			editor.commands.setMark('unclear');

			const saved = fromProseMirror(editor.getJSON() as any);
			expect(compactXml(serializeTei(saved))).toContain(
				'<fwtype="header"><w><unclear>alpha</unclear></w></fw>'
			);

			reloaded = createTestEditor({ content: toProseMirror(saved) as any });
			const text = formWorkNode(reloaded).firstChild;
			expect(text.marks.map((mark: any) => mark.type.name)).toContain('unclear');
		} finally {
			editor.destroy();
			reloaded?.destroy();
		}
	});

	it('uses the main toolbar and Enter to insert fw column and line breaks', async () => {
		const harness = await mountTranscriptionEditor({
			document: parseTei(
				wrapInTei('<pb n="1r"/><cb n="1"/><lb/><fw place="margin right"><w>alpha</w></fw>')
			) as any,
		});

		try {
			const editor = (harness.container.querySelector('.ProseMirror') as any).editor;
			let fwPos = formWorkPosition(editor);
			editor.commands.setTextSelection(fwPos + 6);
			control(harness.container, 'Insert Column').click();
			await tick();

			expect(
				formWorkNode(editor)
					.content.toJSON()
					.map((node: any) => node.type)
			).toEqual(['text', 'columnBreak']);

			fwPos = formWorkPosition(editor);
			editor.commands.setTextSelection(fwPos + formWorkNode(editor).nodeSize - 1);
			editor.view.dom.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
			);
			await tick();

			const content = formWorkNode(editor).content.toJSON();
			expect(content.map((node: any) => node.type)).toEqual([
				'text',
				'columnBreak',
				'lineBreak',
			]);
			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();
			expect(formWorkNode(editor).lastChild.attrs.teiAttrs.break).toBe('no');
		} finally {
			harness.dispose();
		}
	});
});
