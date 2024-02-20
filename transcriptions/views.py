import re

from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_safe
from render_block import render_block_to_string

from collation.forms import TeiCollationFileForm
from collation.models import Witness
from transcriptions import forms, models
from transcriptions.py.tei_to_json import import_transcription


@login_required
@require_safe
def main(request: HttpRequest, witness_pk: int) -> HttpResponse:
    witnesses = Witness.objects.filter(Q(user=request.user) | Q(default=True))
    witness = witnesses.get(pk=witness_pk)
    transcriptions = models.Transcription.objects.filter(
        witness=witness, user=request.user
    )
    context = {
        "page": {"active": "witnesses", "title": "Apatosaurus - Transcription"},
        "witness": witness,
        "transcriptions": transcriptions,
    }
    return render(request, "transcriptions/main.html", context)


@login_required
@require_http_methods(["GET", "POST"])
def new_transcription(request: HttpRequest, witness_pk: int) -> HttpResponse:
    if request.method == "GET":
        form = forms.TranscriptionForm(request.user, witness_pk)
        context = {
            "page": {"active": "witnesses", "active": "collation"},
            "witness_pk": witness_pk,
            "form": form,
        }
        return render(request, "transcriptions/_new_transcription.html", context)
    else:
        form = forms.TranscriptionForm(request.user, witness_pk, request.POST)
        if form.is_valid():
            transcription = form.save()
            resp = HttpResponse()
            resp["HX-Redirect"] = f"/transcriptions/edit/{transcription.pk}/"
            return resp
        else:
            context = {
                "form": form,
            }
            return render(request, "transcriptions/_new_transcription.html", context)


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_transcription(request: HttpRequest, transcription_pk: int):
    transcription = models.Transcription.objects.filter(
        pk=transcription_pk, user=request.user
    ).get()
    if request.method == "GET":
        if request.htmx:
            context = {
                "transcription": transcription,
            }
            template = "transcriptions/_edit_transcription.html"
        else:
            witness = transcription.witness
            transcriptions = models.Transcription.objects.filter(
                witness=witness, user=request.user
            )
            context = {
                "page": {"active": "witnesses", "title": "Apatosaurus - Transcription"},
                "show_transcription": True,
                "witness": witness,
                "transcriptions": transcriptions,
                "transcription": transcription,
            }
            template = "transcriptions/main.html"
        return render(request, template, context)
    elif request.method == "POST":  # always htmx
        success, error = forms.edit_transcription(request.POST, transcription)
        if success:
            resp = HttpResponse()
            resp["HX-Redirect"] = f"/transcriptions/edit/{transcription.pk}/"
            return resp
        else:
            return HttpResponse(error)
    else:
        transcription.delete()
        resp = HttpResponse()
        resp["HX-Redirect"] = reverse(
            "transcriptions", kwargs={"witness_pk": transcription.witness.pk}
        )
        return resp


@login_required
@require_http_methods(["GET", "POST"])
def upload_tei_transcription(request: HttpRequest, witness_pk: int) -> HttpResponse:
    if request.method == "GET":
        form = TeiCollationFileForm()
        context = {
            "witness_pk": witness_pk,
            "form": form,
        }
        return render(request, "transcriptions/_upload_tei.html", context)
    else:
        form = TeiCollationFileForm(request.POST, request.FILES)
        if form.is_valid():
            tei_file = form.cleaned_data["tei_file"]
            witness = Witness.objects.get(pk=witness_pk)
            import_transcription(tei_file, request.user.pk, witness.siglum, witness.pk)
            context = {
                "message": "File uploaded and added to processing queue. You can check the status in your home page.",
                "timout": "3",
            }
            return render(request, "scraps/quick_message.html", context)
        else:
            context = {"form": form}
            return render(
                request, "transcriptions/_upload_tei_transcription.html", context
            )


@login_required
@require_http_methods(["DELETE"])
def delete_all_transcriptions_for_witness(request: HttpRequest, witness_pk: int):
    witness = Witness.objects.get(pk=witness_pk)
    transcriptions = models.Transcription.objects.filter(
        witness=witness, user=request.user
    )
    transcriptions.delete()
    resp = HttpResponse()
    resp["HX-Redirect"] = reverse("transcriptions", kwargs={"witness_pk": witness_pk})
    return resp
