import random
import string

import pydot
from django.http import HttpRequest
from django.shortcuts import render

from collation import models as cmodels

# bgcolor="#00FFFFFF"
# edge [color="#874638"]

GRAPH_TEMPLATE = """
digraph G {
rankdir="TB"
bgcolor="transparent"

node [shape="none"]
nodes
arcs
}""".lstrip()


def make_graph(app: cmodels.App) -> str:
    nodes = "\n".join([f'"{rdg.name}"' for rdg in app.rdgs.all()])  # type: ignore
    arcs = "\n".join([f'"{arc.rdg_from}" -> "{arc.rdg_to}"' for arc in app.arcs.all()])  # type: ignore
    graph_template = GRAPH_TEMPLATE.replace("nodes", nodes).replace("arcs", arcs)
    graphs = pydot.graph_from_dot_data(graph_template)
    if not graphs:
        return ""
    graph = graphs[0]
    svg = graph.create_svg()
    return svg.decode("utf-8")


def mix_basetext_and_apps(ab: cmodels.Ab):
    """
    Mix the basetext and apps into a single list of dicts containing the basetext words and apps.
    """
    combined = []
    app_pk = None
    for word in ab.indexed_basetext:
        if not word["is_variant"]:
            combined.append({"type": "basetext", "word": word})
        else:
            if word["app_pk"] == app_pk:
                continue
            app_pk = word["app_pk"]
            app = cmodels.App.objects.get(pk=app_pk)
            combined.append({"type": "app", "app": app})
    return combined


def random_chars(length=4):
    return "".join(random.choice(string.ascii_letters) for _ in range(length))


def htmx_toast_resp(request: HttpRequest, title: str, message: str, _type: str = None):
    """Returns an HTTP response for htmx requests.
    _type can be "good", "bad" or `None` for neutral."""
    context = {
        "toast_id": random_chars(),
        "toast_title": title,
        "toast_message": message,
        "toast_type": _type,
    }
    resp = render(request, "scraps/toast.html", context)
    resp["HX-Retarget"] = "#toast-container"
    resp["HX-Reswap"] = "afterbegin"
    return resp
