from django import forms
from django.contrib.auth import get_user_model

from collation import models


class CollationForm(forms.ModelForm):
    class Meta:
        model = models.Collation
        exclude = ['user']


    def save(self, user, commit=True):
        instance = super().save(commit=False)
        instance.user = user
        if commit:
            instance.save()
        return instance


class SectionForm(forms.ModelForm):
    class Meta:
        model = models.Section
        exclude = ['collation']

    def save(self, collation_id: int, commit=True):
        instance = super().save(commit=False)
        instance.collation_id = collation_id
        if commit:
            instance.save()
        return instance
        

class AbForm(forms.ModelForm):
    class Meta:
        model = models.Ab
        exclude = ['section', 'indexed_basetext']

    def save(self, section_id: int, commit=True):
        instance = super().save(commit=False)
        instance.section_id = section_id
        if commit:
            instance.save()
        return instance


class AppForm(forms.ModelForm):
    class Meta:
        model = models.App
        exclude = ['ab', 'atype']

    def save(self, ab_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.ab_id = ab_pk
        if commit:
            instance.save()
            instance.ab.save()
        return instance


class RdgForm(forms.ModelForm):

    class Meta:
        model = models.Rdg
        # exclude = ['app', 'active', 'varSeq']
        fields = [
            'name',
            'rtype', 
            'text',
            'selected_witnesses',
            'wit',
            ]

    def save(self, app_pk: int, commit=True):
        instance = super().save(commit=False)
        instance.app_id = app_pk
        if commit:
            instance.save()
            self.save_m2m()
        return instance

    selected_witnesses = forms.CharField(widget=forms.Textarea(attrs={'readonly': True}), required=False)
