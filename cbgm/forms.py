from django import forms

from cbgm import models


class Cbgm_DbForm(forms.ModelForm):
    class Meta:
        model = models.Cbgm_Db
        exclude = ['user', 'db_file', 'amount', 'witnesses', 'app_labels']

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
