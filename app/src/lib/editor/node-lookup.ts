import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function findFirstDescendantPosition(
	root: ProseMirrorNode,
	matches: (node: ProseMirrorNode, position: number) => boolean
): number | null {
	function visit(parent: ProseMirrorNode, contentStart: number): number | null {
		let offset = 0;
		for (let index = 0; index < parent.childCount; index += 1) {
			const child = parent.child(index);
			const position = contentStart + offset;
			if (matches(child, position)) return position;

			const nestedMatch = visit(child, position + 1);
			if (nestedMatch !== null) return nestedMatch;
			offset += child.nodeSize;
		}
		return null;
	}

	return visit(root, 0);
}
