from audioop import mul

from django import forms
from django.http import QueryDict
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe

from peasywidgets.py.helpers import render_attributes

# class DatalistSingle(forms.Widget):
#     def __init__(self, choices=[], attrs=None, datalist_attrs=[], input_attrs=[]):
#         self.choices = choices
#         self.datalist_attrs = datalist_attrs
#         self.input_attrs = input_attrs
#         super().__init__(attrs)

#     def render(self, name, value, attrs=None, renderer=None):
#         current_object = None
#         if value:
#             current_object = self.choices.queryset.get(pk=value)
#         context = {
#             "name": name,
#             "current_object": current_object,
#             "choices": self.choices,
#             "single": "true",
#             "datalist_attrs": render_attributes(self.datalist_attrs),
#             "input_attrs": render_attributes(self.input_attrs),
#         }
#         output = render_to_string("datalist.html", context)
#         return mark_safe(output)


class Datalist(forms.Widget):
    def __init__(
        self,
        multiple=True,
        object_model=None,
        choices=[],
        attrs=None,
        datalist_attrs=[],
        input_attrs=[],
    ):
        self.multiple = multiple
        self.object_model = object_model
        self.choices = choices
        self.datalist_attrs = datalist_attrs
        self.input_attrs = input_attrs
        super().__init__(attrs)

    def render(self, name, value, attrs=None, renderer=None):
        if value is None:
            value = []
        if not hasattr(value, "__iter__"):
            value = [value]
        current_values = (
            [o for o in self.object_model.objects.filter(pk__in=value)]
            if self.object_model
            else value
        )

        context = {
            "name": name,
            "current_values": current_values,
            "choices": self.choices,
            "single": "false" if self.multiple else "true",
            "datalist_attrs": render_attributes(self.datalist_attrs),
            "input_attrs": render_attributes(self.input_attrs),
        }
        output = render_to_string("datalist.html", context)
        return mark_safe(output)

    def value_from_datadict(self, data: QueryDict, files, name):
        if self.multiple:
            return data.getlist(name, None)
        else:
            return super().value_from_datadict(data, files, name)
