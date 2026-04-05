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
	<circle cx="128" cy="104" r="64" stroke-dasharray="24 16" />
	<circle cx="128" cy="200" r="12" fill={color} stroke="none" />
</svg>
