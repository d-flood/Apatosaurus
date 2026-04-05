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
	<path d="M104,48 H48 a8,8 0 0,0 -8,8 V200 a8,8 0 0,0 8,8 H104 L120,176 L88,144 L120,112 L88,80 Z" />
	<path d="M136,48 H208 a8,8 0 0,1 8,8 V200 a8,8 0 0,1 -8,8 H136 L152,176 L120,144 L152,112 L120,80 Z" />
</svg>
