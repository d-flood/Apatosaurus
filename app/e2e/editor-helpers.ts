import type { Locator } from '@playwright/test';

export async function placeCaretAtLineEnd(line: Locator): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const box = await line.boundingBox();
		if (!box) throw new Error('line bounding box not available');

		await line.click({
			position: {
				x: Math.max(0, box.width - 2),
				y: box.height / 2,
			},
		});
		const hasCollapsedCaret = await line.evaluate(element => {
			const selection = window.getSelection();
			return Boolean(
				selection?.isCollapsed &&
				selection.anchorNode &&
				(element === selection.anchorNode || element.contains(selection.anchorNode))
			);
		});
		if (hasCollapsedCaret) {
			// ProseMirror reconciles the browser selection asynchronously.
			await line.page().waitForTimeout(100);
			return;
		}
	}

	throw new Error('failed to place a collapsed caret at the end of the line');
}
