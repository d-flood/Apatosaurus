from django import forms
from django.http import QueryDict
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe


class DatalistSingle(forms.Widget):
    def __init__(self, choices=None, attrs=None):
        self.choices = choices
        super().__init__(attrs)

    def render(self, name, value, attrs=None, renderer=None):
        current_object = None
        if value:
            current_object = self.choices.queryset.get(pk=value)
        context = {
            "name": name,
            "current_object": current_object,
            "choices": self.choices,
            "single": "true",
        }
        output = render_to_string("datalist.html", context)
        return mark_safe(output)


class DatalistMultiple(forms.Widget):
    def __init__(self, object_model, choices=[], attrs=None):
        self.object_model = object_model
        if choices:
            self.choices = choices
        super().__init__(attrs)

    def render(self, name, value, attrs=None, renderer=None):
        if value is None:
            value = []

        context = {
            "name": name,
            "current_values": [
                o for o in self.object_model.objects.filter(pk__in=value)
            ],
            "choices": self.choices,
            "single": "false",
        }
        output = render_to_string("datalist.html", context)
        return mark_safe(output)

    def value_from_datadict(self, data: QueryDict, files, name):
        return data.getlist(name, None)
