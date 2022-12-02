from django.db.models import QuerySet

import pydot

from collation.models import App, Rdg, Arc

# bgcolor="#00FFFFFF"
# edge [color="#874638"]

GRAPH_TEMPLATE = '''
digraph G {
rankdir="TB"
bgcolor="transparent"

node [shape="none"]
nodes
arcs
}'''.lstrip()

def make_graph(app: App) -> str:
    nodes = '\n'.join([rdg.name for rdg in app.rdgs.all()]) # type: ignore
    arcs = '\n'.join([f'{arc.rdg_from} -> {arc.rdg_to}' for arc in app.arcs.all()]) # type: ignore
    graph_template = GRAPH_TEMPLATE.replace('nodes', nodes).replace('arcs', arcs)
    graphs = pydot.graph_from_dot_data(graph_template)
    if not graphs:
        return ''
    graph = graphs[0]
    svg = graph.create_svg()
    return svg.decode('utf-8')


def quick_message(message, klass: str, timeout: int = 2):
    """klass: 'ok', 'warn', 'bad', 'info', 'plain'"""
    return f'<div class="box {klass} color bg" _="on load wait {timeout}s then remove me"><p>{message}</p></div>'
