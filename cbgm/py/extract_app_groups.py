import re


def extract_app_groups(apps: list[str]) -> tuple[dict[str, str | list[tuple[str, str]]]]:
    grouped_apps = {}
    for app in apps:
        ab_name = re.sub(r'U\d+.*', '', app)
        if ab_name not in grouped_apps.keys():
            grouped_apps[ab_name] = {'name': ab_name, 'units': []}
        grouped_apps[ab_name]['units'].append((app, app.replace(f'{ab_name}U', '')))
    return tuple(grouped_apps.values())
