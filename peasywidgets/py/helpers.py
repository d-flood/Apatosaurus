def render_attributes(attrs):
    if not attrs:
        return ""
    return " ".join([f'{k}="{v}"' for k, v in attrs.items()])
