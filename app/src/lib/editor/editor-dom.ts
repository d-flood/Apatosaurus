import {
	autoUpdate,
	computePosition,
	flip,
	offset as floatingOffset,
	shift,
} from '@floating-ui/dom';

export function portal(node: HTMLElement, target: HTMLElement | null) {
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

export function editorTooltips(node: HTMLElement) {
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
		const trigger = event.target.closest<HTMLElement>('.ProseMirror .tooltip[data-tip]');
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

export function getVerticalScrollHost(node: HTMLElement | null): HTMLElement | Window {
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

export function scrollNodeWithinHost(
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

export function isNodeNearViewportTarget(
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

export function findVerseContentAnchor(
	root: HTMLElement | null,
	milestoneNode: HTMLElement
): HTMLElement {
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
