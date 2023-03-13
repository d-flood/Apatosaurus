import re

import pydot


def extract_app_groups(apps: list[str]):
    grouped_apps = {}
    for app in apps:
        ab_name = re.sub(r'U\d+.*', '', app)
        if ab_name not in grouped_apps.keys():
            grouped_apps[ab_name] = {'name': ab_name, 'units': []}
        grouped_apps[ab_name]['units'].append((app, app.replace(f'{ab_name}U', '')))
    return tuple(grouped_apps.values())


def make_svg_from_dot(dot: str) -> str:
    graphs = pydot.graph_from_dot_data(dot)
    if not graphs:
        return ''
    svg = graphs[0].create_svg()
    return svg.decode('utf-8')
