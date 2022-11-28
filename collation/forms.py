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
        exclude = ['section']

    def save(self, section_id: int, commit=True):
        instance = super().save(commit=False)
        instance.section_id = section_id
        if commit:
            instance.save()
        return instance

