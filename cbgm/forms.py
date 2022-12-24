from django import forms

from cbgm import models


class Cbgm_DbForm(forms.ModelForm):
    class Meta:
        model = models.Cbgm_Db
        exclude = ['user', 'db_file', 'amount', 'witnesses', 'app_labels', 'active']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['merge_splits'].widget.attrs['class'] = 'big'
    
    def save(self, user_pk: int, amount: int, commit: bool = True):
        instance = super().save(commit=False)
        self.instance.user_id = user_pk
        self.instance.amount = amount
        if commit:
            instance.save()
        return instance


class UpdateCbgmDbForm(forms.ModelForm):
    class Meta:
        model = models.Cbgm_Db
        fields = ['db_name']


class CompareWitnessesForm(forms.Form):
    def __init__(self, *args, all_witnesses = None, **kwargs):
        super().__init__(*args, **kwargs)
        if not all_witnesses:
            all_witnesses = [('', '')]
        self.fields['comparative_witnesses'].choices = all_witnesses
    witness = forms.CharField(
        max_length=64, 
        required=True, 
        label='Witness', 
        widget=forms.TextInput(attrs={'list': 'witnesses-datalist'})
    )
    comparative_witnesses = forms.MultipleChoiceField(
        required=False,
        label='Witness to Compare', 
        widget=forms.SelectMultiple(attrs={'size': '10', 'style': 'min-width: 300px;'}),
    )


class FindRelativesForm(forms.Form):

    def __init__(self, *args, all_witnesses: list[tuple[str, str]], app_labels: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['witness'].choices = all_witnesses
        self.fields['app_labels'].choices = app_labels

    witness = forms.CharField(
        max_length=64, 
        required=True, 
        label='Witness', 
        widget=forms.TextInput(attrs={'list': 'witnesses-datalist'})
    )
    app_labels = forms.ChoiceField(
        required=True,
        label='Variation Unit Address',
        widget=forms.Select(attrs={'size': '10', 'style': 'min-width: 300px;'}),
    )


class OptimizeSubstemmaForm(forms.Form):

    def __init__(self, *args, all_witnesses: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['witness'].choices = all_witnesses

    witness = forms.CharField(
        max_length=64, 
        required=True, 
        label='Witness', 
        widget=forms.TextInput(attrs={'list': 'witnesses-datalist'})
    )

    max_cost = forms.IntegerField(
        max_value=100, min_value=-1, initial=-1, label='Max Cost (Optional)',
        help_text='Leave at -1 to ignore this option.'
    )


class LocalStemmaForm(forms.Form):
    def __init__(self, *args, app_labels: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['app_labels'].choices = app_labels

    app_labels = forms.ChoiceField(
        required=True,
        label='Variation Unit Address',
        widget=forms.Select(attrs={'size': '10', 'style': 'min-width: 300px;'}),
    )


class TextualFlowForm(forms.Form):
    def __init__(self, *args, app_labels: list[tuple[str, str]], **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['app_labels'].choices = app_labels

    app_labels = forms.ChoiceField(
        required=True,
        label='Variation Unit Address',
        widget=forms.Select(attrs={'size': '10', 'style': 'min-width: 300px;'}),
    )

    graph_type = forms.ChoiceField(
        required=True,
        label='Graph Type',
        choices=(
            ('--flow', 'Flow'),
            ('--attestations', 'Attestations'),
            ('--variants', 'Variants'),
        ),
        widget=forms.RadioSelect(),
    )

    strengths = forms.BooleanField(label='Show Strengths', initial=False, required=False)

    connectivity_limit = forms.IntegerField(
        max_value=100, min_value=-1, initial=-1, label='Connectivity Limit',
        help_text='Leave at -1 to ignore this option.'
    )


class GlobalStemmaForm(forms.Form):

    strengths = forms.BooleanField(label='Show Strengths', initial=False, required=False)
    lengths = forms.BooleanField(label='Show Costs', initial=False, required=False)
