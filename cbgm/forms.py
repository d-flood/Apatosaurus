from django import forms

from cbgm import models
from collation import models as cmodels


class Cbgm_DbForm(forms.ModelForm):
    class Meta:
        model = models.Cbgm_Db
        exclude = [
            "user",
            "db_file",
            "amount",
            "witnesses",
            "app_labels",
            "active",
            "remove_rdg_types_before_import",
        ]

    def __init__(
        self,
        *args,
        user_pk: int = 0,
        corpus_type: int = 0,
        corpus_pk: int = 0,
        **kwargs
    ):
        self.user_pk = user_pk
        super().__init__(*args, **kwargs)
        self.fields["merge_splits"].widget.attrs["class"] = "big"
        if corpus_type == 0:
            rdg_types = self.ignore_rdg_types_choices = (
                cmodels.Rdg.objects.filter(app__ab_id=corpus_pk)
                .distinct()
                .values_list("rtype", flat=True)
            )
        elif corpus_type == 1:
            rdg_types = self.ignore_rdg_types_choices = (
                cmodels.Rdg.objects.filter(app__ab__section_id=corpus_pk)
                .distinct()
                .values_list("rtype", flat=True)
            )
        else:
            rdg_types = self.ignore_rdg_types_choices = (
                cmodels.Rdg.objects.filter(app__ab__section__collation_id=corpus_pk)
                .distinct()
                .values_list("rtype", flat=True)
            )
        self.fields["ignore_rdg_types"].choices = [
            (rdg_type, rdg_type) for rdg_type in set(rdg_types)
        ]

    # ignore_rdg_types = forms.MultipleChoiceField(
    #     label="Strip These Types Entirely",
    #     help_text="Variation units in which all readings but one are of these types will be removed from the collation before being imported into the CBGM.",
    #     required=False,
    #     widget=forms.CheckboxSelectMultiple(attrs={"class": "mr-2 ml-3"}),
    # )

    def get_ignore_rdg_types(self):
        return self.rdg_type_choices

    def save(self, amount: int, commit: bool = True):
        instance = super().save(commit=False)
        self.instance.user_id = self.user_pk
        self.instance.amount = amount
        if commit:
            instance.save()
        return instance

    def clean_db_name(self):
        cleaned_data = super().clean()
        db_name = cleaned_data.get("db_name")
        if db_name:
            if models.Cbgm_Db.objects.filter(
                db_name=db_name, user_id=self.user_pk
            ).exists():
                raise forms.ValidationError(
                    "You already have a database with this name."
                )
        return db_name


class UpdateCbgmDbForm(forms.ModelForm):
    class Meta:
        model = models.Cbgm_Db
        fields = ["db_name"]


class CompareWitnessesForm(forms.Form):
    def __init__(self, *args, all_witnesses=None, **kwargs):
        super().__init__(*args, **kwargs)
        if not all_witnesses:
            all_witnesses = [("", "")]
        self.fields["comparative_witnesses"].choices = all_witnesses

    witness = forms.CharField(
        max_length=64,
        required=True,
        label="Witness",
        widget=forms.TextInput(attrs={"list": "witnesses-datalist"}),
    )
    comparative_witnesses = forms.MultipleChoiceField(
        required=False,
        label="Witness to Compare",
        widget=forms.SelectMultiple(attrs={"size": "10", "style": "min-width: 300px;"}),
    )


class FindRelativesForm(forms.Form):

    def __init__(
        self,
        *args,
        all_witnesses: list[tuple[str, str]],
        app_labels: list[tuple[str, str]],
        **kwargs
    ):
        super().__init__(*args, **kwargs)
        self.fields["witness"].choices = all_witnesses
        self.fields["app_labels"].choices = app_labels
        self.fields["app_labels"].required = True

    witness = forms.CharField(
        max_length=64,
        required=True,
        label="Witness",
        widget=forms.TextInput(attrs={"list": "witnesses-datalist"}),
    )
    app_labels = forms.ChoiceField(
        required=True,
        label="Variation Unit Address",
        widget=forms.Select(attrs={"size": "10", "style": "min-width: 300px;"}),
    )


class OptimizeSubstemmaForm(forms.Form):

    def __init__(self, *args, all_witnesses: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["witness"].choices = all_witnesses

    witness = forms.CharField(
        max_length=64,
        required=True,
        label="Witness",
        widget=forms.TextInput(attrs={"list": "witnesses-datalist"}),
    )

    max_cost = forms.IntegerField(
        max_value=100,
        min_value=-1,
        initial=-1,
        label="Max Cost (Optional)",
        help_text="Leave at -1 to ignore this option.",
    )


class LocalStemmaForm(forms.Form):
    def __init__(self, *args, app_labels: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["app_labels"].choices = app_labels

    app_labels = forms.ChoiceField(
        required=True,
        label="Variation Unit Address",
        widget=forms.Select(attrs={"size": "10", "style": "min-width: 300px;"}),
    )


class TextualFlowForm(forms.Form):
    def __init__(self, *args, app_labels: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["app_labels"].choices = app_labels

    app_labels = forms.ChoiceField(
        required=True,
        label="Variation Unit Address",
        widget=forms.Select(attrs={"size": "10", "style": "min-width: 300px;"}),
    )

    graph_type = forms.ChoiceField(
        required=True,
        label="Graph Type",
        choices=(
            ("--flow", "Flow"),
            ("--attestations", "Attestations"),
            ("--variants", "Variants"),
        ),
        widget=forms.RadioSelect(),
    )

    strengths = forms.BooleanField(
        label="Show Strengths", initial=False, required=False
    )

    connectivity_limit = forms.IntegerField(
        max_value=100,
        min_value=-1,
        initial=-1,
        label="Connectivity Limit",
        help_text="Leave at -1 to ignore this option.",
    )

    email_graph = forms.BooleanField(
        label="Email Graph",
        initial=False,
        required=False,
    )


class GlobalStemmaForm(forms.Form):

    strengths = forms.BooleanField(
        label="Show Strengths", initial=False, required=False
    )
    lengths = forms.BooleanField(label="Show Costs", initial=False, required=False)
    email_graph = forms.BooleanField(
        label="Email Graph",
        initial=False,
        required=False,
    )
