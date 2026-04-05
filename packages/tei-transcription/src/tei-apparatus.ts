const UNSUPPORTED_DESCENDANTS = new Set([
	'lem',
	'rdggrp',
	'listapp',
	'notegrp',
	'mod',
	'redo',
	'undo',
	'retrace',
	'transpose',
	'listtranspose',
	'substjoin',
]);

export function isSimpleCorrectionApp(appElement: Element): boolean {
	for (const tagName of UNSUPPORTED_DESCENDANTS) {
		if (appElement.getElementsByTagName(tagName).length > 0) {
			return false;
		}
	}

	for (const rdg of Array.from(appElement.getElementsByTagName('rdg')) as Element[]) {
		const type = rdg.getAttribute('type');
		if (type && type !== 'orig' && type !== 'corr' && type !== 'alt') {
			return false;
		}
		if (rdg.getAttribute('wit')) {
			return false;
		}
	}

	return true;
}
