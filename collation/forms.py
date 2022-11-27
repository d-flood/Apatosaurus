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
        