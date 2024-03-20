from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods, require_safe
from render_block import render_block_to_string

from collation import models as cmodels
from witnesses import forms


@login_required
@require_safe
def main(request: HttpRequest) -> HttpResponse:
    default_witnesses = cmodels.Witness.objects.filter(default=True).order_by("pk")
    if request.htmx:
        user_witnesses = None
        form = None
        template = "witnesses.html#default-witnesses"
        resp_headers = {"Cache-Control": f"private, max-age={60*60}"}
    else:
        user_witnesses = cmodels.Witness.objects.filter(user=request.user)
        form = forms.WitnessForm()
        template = "witnesses.html"
        resp_headers = {}

    paginator = Paginator(default_witnesses, 500)
    page_number = int(request.GET.get("page", 1))
    default_witnesses_page = paginator.get_page(page_number)

    context = {
        "page": {"active": "witnesses", "title": "Apatosaurus - Witnesses"},
        "default_witnesses": default_witnesses_page,
        "user_witnesses": user_witnesses,
        "form": form,
        "page_number": page_number,
    }

    resp = render(request, template, context)
    for k, v in resp_headers.items():
        resp[k] = v
    return resp


@login_required
@require_http_methods(["POST"])
def add_new_witness(request: HttpRequest) -> HttpResponse:
    form = forms.WitnessForm(request.POST, user_pk=request.user.pk)
    if form.is_valid():
        form.save(request.user.pk)
    new_witness_form = render_block_to_string(
        "witnesses.html",
        "new_witness_form",
        request=request,
        context={"form": form},
    )
    resp = HttpResponse(new_witness_form)
    resp["HX-Trigger"] = "refreshUserWitnesses"
    return resp


@login_required
@require_safe
def refresh_user_witnesses(request: HttpRequest) -> HttpResponse:
    user_witnesses = cmodels.Witness.objects.filter(user=request.user)
    user_witnesses_html = render_block_to_string(
        "witnesses.html",
        "user_witnesses",
        request=request,
        context={"user_witnesses": user_witnesses},
    )
    return HttpResponse(user_witnesses_html)


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_witness(request: HttpRequest, witness_pk: int):
    witness = cmodels.Witness.objects.get(pk=witness_pk)
    if request.method == "GET":
        form = forms.WitnessForm(instance=witness, user_pk=request.user.pk)
        return render(
            request, "witnesses/edit_witness.html", {"form": form, "witness": witness}
        )
    elif request.method == "POST":
        form = forms.WitnessForm(
            request.POST, instance=witness, user_pk=request.user.pk
        )
        if form.is_valid():
            form.save(request.user.pk)
            new_witness_form = render_block_to_string(
                "witnesses.html",
                "new_witness_form",
                request=request,
                context={"form": form},
            )
            resp = HttpResponse(new_witness_form)
            resp["HX-Trigger"] = "refreshUserWitnesses"
            return resp
        return render(
            request, "witnesses/edit_witness.html", {"form": form, "witness": witness}
        )
    else:
        witness.delete()
        new_wit_form = render_block_to_string(
            "witnesses.html",
            "new_witness_form",
            request=request,
            context={"form": forms.WitnessForm()},
        )
        resp = HttpResponse(new_wit_form)
        resp["HX-Trigger"] = "refreshUserWitnesses"
        return resp


@login_required
@require_safe
def cancel_edit_witness(request: HttpRequest):
    new_wit_form = render_block_to_string(
        "witnesses.html",
        "new_witness_form",
        request=request,
        context={"form": forms.WitnessForm()},
    )
    return HttpResponse(new_wit_form)
