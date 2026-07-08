import { Editor } from '@tiptap/core';

const initializedEditors = new WeakSet<Editor>();

export function initializeEditorContent(
	editor: Editor,
	content: Record<string, any>,
	options: { emitUpdate?: boolean } = { emitUpdate: false }
): void {
	if (initializedEditors.has(editor)) {
		throw new Error('setContent is init-only for editor documents; use a transaction after load');
	}
	editor.commands.setContent(content, options);
	initializedEditors.add(editor);
	const originalDispatchTransaction = editor.view.dispatch;
	editor.view.dispatch = transaction => {
		const firstStep = transaction.steps[0]?.toJSON?.();
		if (
			transaction.getMeta('allowFullDocumentReplacement') !== true &&
			transaction.docChanged &&
			transaction.steps.length === 1 &&
			firstStep?.stepType === 'replace' &&
			firstStep.from === 0 &&
			firstStep.to === transaction.before.content.size &&
			transaction.selectionSet === false
		) {
			throw new Error('setContent is init-only for editor documents; use a transaction after load');
		}
		originalDispatchTransaction.call(editor.view, transaction);
	};
}
