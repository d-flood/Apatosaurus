from django import forms
from django.http import QueryDict

from transcriptions import models


class TranscriptionForm(forms.ModelForm):
    def __init__(self, user, witness_pk, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.witness_pk = witness_pk

    class Meta:
        model = models.Transcription
        fields = ("name",)

    text = forms.CharField(widget=forms.Textarea)

    def clean_text(self) -> list[dict[str, str]]:
        text = self.cleaned_data["text"]
        return [{"t": token, "n": token} for token in text.split()]

    def clean_name(self) -> str:
        name = self.cleaned_data["name"]
        if models.Transcription.objects.filter(
            witness_id=self.witness_pk, name=name
        ).exists():
            raise forms.ValidationError("A transcription with that name already exists")
        return name

    def save(self, commit=True):
        transcription = super().save(commit=False)
        transcription.user = self.user
        transcription.witness_id = self.witness_pk
        transcription.tokens = self.cleaned_data["text"]
        if commit:
            transcription.save()
        return transcription


def edit_transcription(post_data: QueryDict, transcription: models.Transcription):
    original: list[str] = post_data.getlist("original")
    normalized: list[str] = post_data.getlist("normalized")
    if len(original) != len(normalized):
        return (False, "original and normalized must be the same length")
    tokens = []
    for t, n in zip(original, normalized):
        tokens.append({"t": t, "n": n})
    transcription.tokens = tokens
    transcription.save()
    return (True, None)
