<script lang="ts">
	interface Props {
		size?: number | string;
		color?: string;
		weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
		[key: string]: any;
	}

	let {
		size = 24,
		color = 'currentColor',
		weight = 'regular',
		...props
	}: Props = $props();

	const strokeWidth = $derived(
		weight === 'bold' ? 24 : weight === 'light' ? 12 : weight === 'thin' ? 8 : 16
	);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	fill={weight === 'fill' ? color : 'none'}
	stroke={weight === 'fill' ? 'none' : color}
	stroke-linecap="round"
	stroke-linejoin="round"
	stroke-width={strokeWidth}
	viewBox="0 0 256 256"
	{...props}
>
	<line x1="48" y1="128" x2="208" y2="128" />
	<line x1="128" y1="48" x2="128" y2="208" />
	<circle cx="88" cy="88" r="8" fill={color} stroke="none" />
	<circle cx="168" cy="88" r="8" fill={color} stroke="none" />
	<circle cx="88" cy="168" r="8" fill={color} stroke="none" />
	<circle cx="168" cy="168" r="8" fill={color} stroke="none" />
</svg>
