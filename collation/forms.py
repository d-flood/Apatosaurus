from audioop import mul

from django import forms
from django.contrib.auth import get_user_model

# from django.db.models import BaseManager
from django.db.models import Count, Q
from django.db.utils import IntegrityError
from django.http import HttpRequest, QueryDict
from django.urls import reverse_lazy
from lxml import etree as et

import witnesses
from collation import models
from collation.py import helpers, process_tei
from peasywidgets.datalist_widgets import Datalist


class ChoiceFieldNoValidation(forms.ChoiceField):
    def valid_value(self, value):
        return True


class CollationForm(forms.ModelForm):
    class Meta:
        model = models.Collation
        exclude = ["user", "slug"]

    def save(self, user, commit=True):
        instance = super().save(commit=False)
        instance.user = user
        if commit:
            instance.save()
        return instance


class SectionForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["published"].widget.attrs.update(
            {
                "style": "height: 1.5em; width: 1.5em; margin-top: 5px;",
            }
        )

    class Meta:
        model = models.Section
        exclude = ["collation", "slugname"]

    def save(self, collation_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.collation_id = collation_pk
        if commit:
            instance.save()
        return instance


class AbForm(forms.ModelForm):
    class Meta:
        model = models.Ab
        exclude = ["section", "indexed_basetext", "slugname"]

    def clean_name(self):
        name = self.cleaned_data["name"]
        if not name:
            raise forms.ValidationError("Name cannot be empty")
        if "/" in name or "\\" in name:
            raise forms.ValidationError('Name cannot contain slashes "/" "\\"')
        return name

    def save(self, section_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.section_id = section_pk
        if commit:
            instance.save()
        return instance


class AbNoteForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["note"].widget.attrs.update(
            {
                "rows": 10,
                "cols": 60,
                "hx-post": reverse_lazy("ab-note", kwargs={"ab_pk": self.instance.pk}),  # type: ignore
                "hx-trigger": "keyup changed delay:1s",
                "hx-target": f"#note-{self.instance.pk}",  # type: ignore
                "_": f"on keyup remove .bg-teal-300 .dark:bg-teal-700 from #note-header-{self.instance.pk} then add .bg-red-500 .dark:bg-red-800 .text-white to #note-header-{self.instance.pk} end",
            }
        )

    class Meta:
        model = models.Ab
        fields = ["note"]


class AppForm(forms.ModelForm):
    class Meta:
        model = models.App
        exclude = ["ab", "atype", "slugname"]

    def save(self, ab_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.ab_id = ab_pk
        if commit:
            instance.save(ab_pk=ab_pk)
            instance.ab.save()
        return instance


class RdgForm(forms.ModelForm):
    def __init__(self, *args, app: models.App, user, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["wit"].queryset = models.Witness.objects.filter(
            Q(default=True) | Q(user=user)
        )
        self.fields["target"].queryset = app.rdgs.filter(witDetail=False)
        self.fields["target"].widget.attrs.update(
            {
                "_": "on load if #id_witDetail.checked hide #div_id_rtype then hide #div_id_text else hide #div_id_target end",
            }
        )

    class Meta:
        model = models.Rdg
        fields = [
            "witDetail",
            "name",
            "rtype",
            "text",
            "target",
            "wit",
        ]
        widgets = {
            "wit": Datalist(multiple=True, object_model=models.Witness),
            "target": Datalist(multiple=True, object_model=models.Rdg),
        }

    def save(self, app_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.app_id = app_pk
        if commit:
            instance.save()
            self.save_m2m()
        return instance

    rtype = forms.CharField(
        widget=forms.TextInput(attrs={"list": "rdg-types", "autocomplete": "off"}),
    )
    witDetail = forms.BooleanField(
        widget=forms.CheckboxInput(
            attrs={
                "_": "on change if me.checked show #div_id_target then hide #div_id_rtype then hide #div_id_text else hide #div_id_target then show #div_id_rtype then show #div_id_text end on load if me.checked hide #div_id_rtype then hide #div_id_text else hide #div_id_target end"
            }
        ),
        required=False,
        label="Ambiguous Reading",
    )


class RdgNoteForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["note"].widget.attrs.update(
            {
                "rows": 5,
                "cols": 40,
                "hx-post": reverse_lazy("reading-note", kwargs={"rdg_pk": self.instance.pk}),  # type: ignore
                "hx-trigger": "keyup changed delay:1s",
                "hx-target": f"#note-{self.instance.pk}",  # type: ignore
                # 'hx-swap': 'outerHTML',
                "_": f"on keyup remove .bg-teal-300 .dark:bg-teal-700 from #note-header-{self.instance.pk} then add .bg-red-500 .dark:bg-red-800 .text-white to #note-header-{self.instance.pk} end",
            }
        )

    class Meta:
        model = models.Rdg
        fields = ["note"]


class ArcForm(forms.Form):
    def __init__(self, app_instance: models.App, *args, **kwargs):
        self.app_instance = app_instance
        super().__init__(*args, **kwargs)
        self.fields["rdg_from"].queryset = app_instance.rdgs.all()  # type: ignore
        self.fields["rdg_to"].queryset = app_instance.rdgs.all()  # type: ignore

    rdg_from = forms.ModelChoiceField(queryset=models.Rdg.objects.all(), widget=forms.RadioSelect, required=True)  # type: ignore
    rdg_to = forms.ModelChoiceField(queryset=models.Rdg.objects.all(), widget=forms.RadioSelect, required=True)  # type: ignore

    def save(self, app):
        try:
            return models.Arc.objects.create(
                rdg_from=self.cleaned_data["rdg_from"],
                rdg_to=self.cleaned_data["rdg_to"],
                app=app,
            )
        except IntegrityError:
            return None


class TeiCollationFileForm(forms.Form):
    tei_file = forms.FileField(label="Collation File", required=True)

    def clean_tei_file(self):
        tei_file = self.cleaned_data["tei_file"]
        if not tei_file.name.endswith(".xml"):
            raise forms.ValidationError("File must be a .xml file")
        # try:
        # return process_tei.parse_xml(tei_file)
        return tei_file
        # except et.XMLSyntaxError as e:
        #     raise forms.ValidationError('Uploaded file is not valid XML') from e


def variant_filter_is_valid(request: HttpRequest) -> tuple[bool, str]:
    data = request.GET
    if all(
        [
            not data.getlist("all-of"),
            not data.getlist("any-of"),
            not data.getlist("none-of"),
        ]
    ):
        return (
            False,
            'You must enter a witness in at least one of "All of", "Any of", or "None of"',
        )
    elif data.get("only-these") and not data.get("all-of"):
        return False, 'You must enter a witness in "All of" if you select "Only these"'
    return True, ""


class CollationConfigForm(forms.ModelForm):
    def __init__(self, user_id, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["witnesses"].queryset = models.Witness.objects.filter(
            Q(default=True) | Q(user_id=user_id)
        )
        self.fields["basetext"].queryset = models.Witness.objects.filter(
            Q(default=True) | Q(user=user_id)
        )
        self.initial["transcription_name"] = [
            self.initial.get("transcription_name", ""),
        ]

    class Meta:
        model = models.CollationConfig
        fields = [
            "witnesses",
            "basetext",
            "transcription_name",
        ]
        widgets = {
            "witnesses": Datalist(multiple=True, object_model=models.Witness),
            "basetext": Datalist(multiple=False, object_model=models.Witness),
        }

    def save(self, ab_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.ab_id = ab_pk
        if commit:
            instance.save()
        self.save_m2m()
        return instance

    transcription_name = ChoiceFieldNoValidation(
        label="Transcription Name",
        widget=Datalist(
            multiple=False,
            datalist_attrs={
                "hx-get": reverse_lazy("get-unique-ab-names"),
                "hx-trigger": "getAbNames",
                "hx-include": "#collate-form",
            },
        ),
    )


class PreviousCollationForm(forms.Form):
    def __init__(self, user_pk, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["collation_config"].queryset = (
            models.CollationConfig.objects.filter(
                ab__section__collation__user_id=user_pk
            )
        )

    collation_config = forms.ModelChoiceField(
        label="Existing Collation",
        queryset=models.CollationConfig.objects.none(),
        widget=Datalist(multiple=False, object_model=models.CollationConfig),
        required=True,
    )
