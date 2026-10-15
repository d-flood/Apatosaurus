export async function renderDot(dot: string): Promise<string> {
	const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
	const graphviz = await Graphviz.load();
	return graphviz.dot(dot);
}

export function splitDigraphs(dot: string): string[] {
	return dot.split(/^(?=digraph\b)/m).filter(graph => graph.trim() !== '');
}
