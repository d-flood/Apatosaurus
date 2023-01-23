from django import forms

from witnesses import models
from collation import models as cmodels


class WitnessForm(forms.ModelForm):

    def __init__(self, *args, **kwargs):
        self.user_pk = kwargs.pop('user_pk', None)
        super().__init__(*args, **kwargs)

    class Meta:
        model = cmodels.Witness
        fields = [
            'siglum',
            'description',
            ]

    def save(self, user_pk: int, default: bool = False, commit=True):
        instance = super().save(commit=False)
        instance.user_id = user_pk
        instance.default = default
        if commit:
            instance.save()
            self.save_m2m()
        return instance

    description = forms.CharField(widget=forms.Textarea(attrs={'rows': 2}), required=False, max_length=255)

    def clean_siglum(self):
        if self.instance.pk:
            return self.cleaned_data['siglum']
        siglum = self.cleaned_data['siglum']
        if cmodels.Witness.objects.filter(siglum=siglum, user_id=self.user_pk).exists():
            raise forms.ValidationError('You already have a witness with this siglum.')
        return siglum
