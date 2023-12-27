from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods, require_safe
from render_block import render_block_to_string

from collation import forms, models
from collation.py import helpers, import_collation
from collation.py.filter_apps import filter_variants_by_witnesses
from witnesses.py.sort_ga_witnesses import sort_ga_witnesses


@login_required
@require_safe
def main(request: HttpRequest):
    if request.htmx:  # type: ignore
        return collations(request)
    context = {
        "page": {"active": "collation", "title": "Apatosaurus - Collation"},
        "collation_list": True,
    }
    return render(request, "collation/main.html", context)


@login_required
@require_http_methods(["GET", "POST"])
def new_colation(request: HttpRequest):
    if request.method == "GET":
        form = forms.CollationForm()
        context = {
            "page": {"active": "collation"},
            "new_collation_form": forms.CollationForm(),
        }
        return render(request, "collation/new_collation.html", context)
    else:
        form = forms.CollationForm(request.POST)
        if form.is_valid():
            form.save(request.user)
            resp = HttpResponse()
            resp["HX-Redirect"] = "/collation"
            return resp
        return render(
            request, "collation/new_collation.html", {"page": {"active": "collation"}}
        )


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_collation(request: HttpRequest, collation_pk: int):
    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    if request.method == "GET":
        form = forms.CollationForm(instance=collation)
        context = {
            "page": {"active": "collation"},
            "form": form,
            "collation": collation,
        }
        return render(request, "collation/edit_collation.html", context)
    elif request.method == "POST":
        form = forms.CollationForm(request.POST, instance=collation)
        if form.is_valid():
            form.save(request.user)
            resp = HttpResponse()
            resp["HX-Redirect"] = "/collation"
            return resp
        context = {
            "page": {"active": "collation"},
            "form": form,
            "collation": collation,
        }
        return render(request, "collation/edit_collation.html", context)
    else:
        collation.delete()
        resp = HttpResponse()
        resp["HX-Redirect"] = "/collation"
        return resp


@login_required
@require_http_methods(["GET", "POST"])
def new_section(request: HttpRequest, collation_pk: int):
    if request.method == "GET":
        form = forms.SectionForm()
        context = {
            "page": {"active": "collation"},
            "new_section_form": forms.SectionForm(),
            "collation_pk": collation_pk,
        }
        return render(request, "collation/new_section.html", context)
    else:
        form = forms.SectionForm(request.POST)
        if form.is_valid():
            form.save(collation_pk)
            resp = render(
                request,
                "scraps/quick_message.html",
                {"message": "Section/Chapter saved", "timout": "3"},
            )
            resp["HX-Trigger"] = "refreshSections"
            return resp
        return render(
            request, "collation/new_section.html", {"page": {"active": "collation"}}
        )


@login_required
@require_safe
def analyze_collation(request: HttpRequest, collation_pk: int):
    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    witnesses = (
        models.Witness.objects.filter(rdgs__app__ab__section__collation=collation)
        .distinct()
        .values_list("siglum", flat=True)
    )
    rtypes = (
        models.Rdg.objects.filter(app__ab__section__collation=collation)
        .distinct()
        .values_list("rtype", flat=True)
    )
    witnesses = sort_ga_witnesses(list(witnesses))
    context = {
        "page": {"active": "collation"},
        "selected_collation": collation,
        "witnesses": witnesses,
        "rtypes": sorted(set(rtypes)),
        "collation_list": True,
        "analyze_collation": True,
    }
    if request.htmx:  # type: ignore
        return render(request, "collation/_analyze.html", context)
    else:
        return render(request, "collation/main.html", context)


@login_required
@require_safe
def filter_variants(request: HttpRequest, collation_pk: int):
    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    witnesses = (
        models.Witness.objects.filter(rdgs__app__ab__section__collation=collation)
        .distinct()
        .values_list("siglum", flat=True)
    )
    rtypes = (
        models.Rdg.objects.filter(app__ab__section__collation=collation)
        .distinct()
        .values_list("rtype", flat=True)
    )
    context = {
        "page": {"active": "collation"},
        "selected_collation": collation,
        "witnesses": witnesses,
        "rtypes": sorted(set(rtypes)),
        "collation_list": True,
        "analyze_collation": True,
        "load_filtered_variants": True,
    }
    result, message = forms.variant_filter_is_valid(request)
    if not result:
        if request.htmx:  # type: ignore
            resp = HttpResponse(message)
            resp["HX-Retarget"] = "#filter-form-errors"
            return resp
        else:
            context["filter_form_errors"] = message
            return render(request, "collation/main.html", context)
    apps, total = filter_variants_by_witnesses(request, collation_pk)
    context.update({"apps": apps, "total": total})
    if request.htmx:  # type: ignore
        return render(request, "collation/_filtered_variants.html", context)
    else:
        return render(request, "collation/main.html", context)


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_section(request: HttpRequest, section_pk: int):
    if request.method == "GET":
        section = models.Section.objects.get(pk=section_pk)
        form = forms.SectionForm(instance=section)
        context = {"page": {"active": "collation"}, "form": form, "section": section}
        return render(request, "collation/edit_section.html", context)
    elif request.method == "POST":
        section = models.Section.objects.get(pk=section_pk)
        form = forms.SectionForm(request.POST, instance=section)
        if form.is_valid():
            form.save(section.collation.pk)
            return render(
                request,
                "scraps/quick_message.html",
                {"message": "Section/Chapter saved", "timout": "3"},
            )
        return render(
            request, "collation/edit_section.html", {"page": {"active": "collation"}}
        )
    else:
        section = models.Section.objects.get(pk=section_pk)
        section.delete()
        resp = render(
            request,
            "scraps/quick_message.html",
            {"message": "Section deleted", "timout": "3"},
        )
        resp["HX-Trigger"] = "refreshSections"
        return resp


@login_required
@require_http_methods(["GET", "POST"])
def new_ab(request: HttpRequest, section_pk: int):
    if request.method == "GET":
        form = forms.AbForm()
        context = {
            "page": {"active": "collation"},
            "new_ab_form": forms.AbForm(),
            "section_pk": section_pk,
        }
        return render(request, "collation/new_ab.html", context)
    else:
        form = forms.AbForm(request.POST)
        if form.is_valid():
            form.save(section_pk)
            resp = render(
                request,
                "scraps/quick_message.html",
                {"message": "Collation unit saved", "timout": "3"},
            )
            resp["HX-Trigger"] = "refreshAbs"
            return resp
        return render(
            request,
            "collation/new_ab.html",
            {
                "page": {"active": "collation"},
                "section_pk": section_pk,
                "new_ab_form": form,
            },
        )


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_ab(request: HttpRequest, ab_pk: int):
    if request.method == "GET":
        ab = models.Ab.objects.get(pk=ab_pk)
        form = forms.AbForm(instance=ab)
        context = {"page": {"active": "collation"}, "form": form, "ab": ab}
        return render(request, "collation/edit_ab.html", context)
    elif request.method == "POST":
        ab = models.Ab.objects.get(pk=ab_pk)
        form = forms.AbForm(request.POST, instance=ab)
        if form.is_valid():
            form.save(ab.section.pk)
            resp = HttpResponse("Ab saved")
            resp["HX-Trigger"] = "refreshAbs"
            return resp
        context = {"page": {"active": "collation"}, "form": form, "ab": ab}
        return render(request, "collation/edit_ab.html", context)
    else:
        ab = models.Ab.objects.get(pk=ab_pk)
        ab.delete()
        resp = render(
            request,
            "scraps/quick_message.html",
            {"message": f"{ab.name} deleted", "timout": "3"},
        )
        resp["HX-Trigger"] = "refreshAbs"
        return resp


@login_required
@require_http_methods(["GET", "POST"])
def new_rdg(request: HttpRequest, app_pk: int):
    app = models.App.objects.filter(ab__section__collation__user=request.user).get(
        pk=app_pk
    )
    if request.method == "GET":
        form = forms.RdgForm(app=app, user=request.user)
        context = {
            "page": {"active": "collation"},
            "form": form,
            "app_pk": app_pk,
            "rtypes": models.Rdg.RDG_CHOICES,
        }
    else:
        form = forms.RdgForm(request.POST, app=app, user=request.user)
        if form.is_valid():
            form.save(app_pk)
            app = app
            context = {
                "app": app,
                "arc_form": forms.ArcForm(models.App.objects.get(pk=app_pk)),
                "local_stemma": helpers.make_graph(models.App.objects.get(pk=app_pk)),
                "rdgs": app.rdgs.filter(witDetail=False),
                "witDetails": app.rdgs.filter(witDetail=True),
            }
            return render(request, "collation/_rdgs_table.html", context)
        context = {
            "form": form,
            "app_pk": app_pk,
            "rtypes": models.Rdg.RDG_CHOICES,
        }

    return render(request, "collation/new_rdg.html", context)


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_rdg(request: HttpRequest, rdg_pk: int):
    if request.method == "GET":
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        form = forms.RdgForm(instance=rdg, app=rdg.app, user=request.user)
        context = {
            "page": {"active": "collation"},
            "form": form,
            "rdg": rdg,
            "rtypes": models.Rdg.RDG_CHOICES,
        }
        return render(request, "collation/edit_rdg.html", context)
    elif request.method == "POST":
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        form = forms.RdgForm(request.POST, instance=rdg, app=rdg.app, user=request.user)
        if form.is_valid():
            form.save(rdg.app.pk)
            app = rdg.app
            context = {
                "app": app,
                "arc_form": forms.ArcForm(models.App.objects.get(pk=app.pk)),
                "local_stemma": helpers.make_graph(models.App.objects.get(pk=app.pk)),
                "rdgs": app.rdgs.filter(witDetail=False),
                "witDetails": app.rdgs.filter(witDetail=True),
            }
            return render(request, "collation/_rdgs_table.html", context)
        context = {
            "form": form,
            "rdg": rdg,
            "rtypes": models.Rdg.RDG_CHOICES,
        }
        return render(request, "collation/edit_rdg.html", context)
    else:
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        app = rdg.app
        rdg.delete()
        context = {
            "app": app,
            "arc_form": forms.ArcForm(models.App.objects.get(pk=app.pk)),
            "local_stemma": helpers.make_graph(models.App.objects.get(pk=app.pk)),
            "rdgs": app.rdgs.filter(witDetail=False),
            "witDetails": app.rdgs.filter(witDetail=True),
        }
        return render(request, "collation/_rdgs_table.html", context)


def cancel_new_rdg(request: HttpRequest, app_pk: int):
    app = models.App.objects.get(pk=app_pk)
    context = {
        "app": app,
        "arc_form": forms.ArcForm(models.App.objects.get(pk=app.pk)),
        "local_stemma": helpers.make_graph(models.App.objects.get(pk=app.pk)),
        "rdgs": app.rdgs.filter(witDetail=False),
        "witDetails": app.rdgs.filter(witDetail=True),
    }
    return render(request, "collation/_rdgs_table.html", context)


@login_required
def sections(request: HttpRequest, collation_pk: int):
    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    context = {
        "page": {"active": "collation"},
        "collation": collation,
        "section_list": True,
    }
    if request.htmx:  # type: ignore
        return render(request, "collation/_sections.html", context)
    else:
        return render(request, "collation/main.html", context)


@login_required
def collations(request: HttpRequest):
    context = {
        "page": {"active": "collation"},
        "collations": models.Collation.objects.filter(user=request.user),
    }
    return render(request, "collation/collations.html", context)


@login_required
def abs(request: HttpRequest, section_pk: int):
    section = models.Section.objects.filter(collation__user=request.user).get(
        pk=section_pk
    )
    context = {
        "page": {"active": "collation"},
        "abs": section.abs.all(),
        "section": section,
        "ab_list": True,
    }
    if request.htmx:  # type: ignore
        return render(request, "collation/_abs.html", context)
    else:
        return render(request, "collation/main.html", context)


@login_required
@require_safe
def apparatus(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.filter(section__collation__user=request.user).get(pk=ab_pk)
    context = {
        "page": {"active": "collation"},
        "ab": ab,
        "ab_list": True,
        "load_apparatus": True,
    }
    if request.htmx:  # type: ignore
        return render(request, "collation/_apparatus.html", context)
    else:
        return render(request, "collation/main.html", context)


@login_required
@require_http_methods(["GET", "POST", "DELETE"])
def edit_app(
    request: HttpRequest, ab_pk: int, app_pk: int, permanently_delete: str | None = None
):
    if request.method == "GET":
        form = (
            forms.AppForm()
            if app_pk == 0
            else forms.AppForm(instance=models.App.objects.get(pk=app_pk))
        )
        context = {
            "page": {"active": "collation"},
            "form": form,
            "app_pk": app_pk,
            "ab_pk": ab_pk,
        }
        return render(request, "collation/app_form.html", context)
    elif request.method == "POST":
        if app_pk == 0:
            form = forms.AppForm(request.POST)
        else:
            form = forms.AppForm(
                request.POST, instance=models.App.objects.get(pk=app_pk)
            )
        if form.is_valid():
            app = form.save(ab_pk)
            app.ab.save()  # calling save() on the ab will update the basetext indexing
            app_buttons = render_block_to_string(
                "collation/_apparatus.html",
                "app_buttons",
                {"ab": models.Ab.objects.get(pk=ab_pk)},
            )
            resp = HttpResponse(app_buttons)
            resp["HX-Trigger"] = "refreshBasetext"
            return resp
        else:
            context = {
                "page": {"active": "collation"},
                "form": form,
                "app_pk": app_pk,
                "ab_pk": ab_pk,
            }
            return render(request, "collation/app_form.html", context)
    else:
        app = models.App.objects.get(pk=app_pk)
        ab = app.ab
        if permanently_delete == "yes":
            app.delete()
        else:
            app.mark_deleted()
        ab.save()
        app_buttons = render_block_to_string(
            "collation/_apparatus.html",
            "app_buttons",
            {"ab": models.Ab.objects.get(pk=ab_pk)},
        )
        resp = HttpResponse(app_buttons)
        resp["HX-Trigger"] = "refreshBasetext"
        return resp


def cancel_edit_app(request: HttpRequest, ab_pk: int):
    app_buttons = render_block_to_string(
        "collation/_apparatus.html",
        "app_buttons",
        {"ab": models.Ab.objects.get(pk=ab_pk)},
    )
    return HttpResponse(app_buttons)


@login_required
@require_safe
def show_deleted_apps(request: HttpRequest, ab_pk: int):
    deleted_apps = models.App.objects.filter(ab__pk=ab_pk, deleted=True)
    context = {
        "ab": models.Ab.objects.get(pk=ab_pk),
        "deleted_apps": deleted_apps,
    }
    return render(request, "collation/_deleted_apps.html", context)


@login_required
@require_http_methods(["POST"])
def restore_app(request: HttpRequest, app_pk: int):
    app = models.App.objects.filter(ab__section__collation__user=request.user).get(
        pk=app_pk
    )
    app.deleted = False
    app.save()
    app.ab.save()
    app_buttons = render_block_to_string(
        "collation/_apparatus.html", "app_buttons", {"ab": app.ab}
    )
    resp = HttpResponse(app_buttons)
    resp["HX-Trigger"] = "refreshBasetext"
    return resp


@login_required
@require_http_methods(["POST"])
def combine_apps(request: HttpRequest):
    if (appSource := request.POST.get("appSource")) and (
        appTarget := request.POST.get("appTarget")
    ):
        app1_pk = int(appSource.replace("app-", ""))
        app2_pk = int(appTarget.replace("app-", ""))
    else:
        return HttpResponse(status=204)
    app1 = models.App.objects.filter(ab__section__collation__user=request.user).get(
        pk=app1_pk
    )
    app2 = models.App.objects.filter(ab__section__collation__user=request.user).get(
        pk=app2_pk
    )
    app1.combine_with(app2)
    app_buttons = render_block_to_string(
        "collation/_apparatus.html", "app_buttons", {"ab": app1.ab}
    )
    resp = HttpResponse(app_buttons)
    resp["HX-Trigger"] = "refreshBasetext"
    return resp


@login_required
@require_safe
def rdgs(request: HttpRequest, app_pk: int):
    app = models.App.objects.filter(ab__section__collation__user=request.user).get(
        pk=app_pk
    )
    ab = app.ab
    section = ab.section
    collation = section.collation
    context = {
        "page": {"active": "collation"},
        "collation": collation,
        "section": section,
        "ab": ab,
        "app": app,
        "rdgs": app.rdgs.filter(witDetail=False),
        "witDetails": app.rdgs.filter(witDetail=True),
        "arc_form": forms.ArcForm(app),
        "local_stemma": helpers.make_graph(app),
        "ab_list": True,
        "load_apparatus": True,
        "load_rdgs": True,
    }
    if request.htmx:  # type: ignore
        return render(request, "collation/_rdgs_table.html", context)
    else:
        context["browser_load"] = "true"
        return render(request, "collation/main.html", context)


@login_required
@require_safe
def refresh_basetext(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.get(pk=ab_pk)
    basetext_row = render_block_to_string(
        "collation/_apparatus.html", "basetext_row", {"ab": ab}
    )
    return HttpResponse(basetext_row)


@login_required
@require_http_methods(["POST"])
def edit_arc(request: HttpRequest, app_pk: int, delete: int):
    app = models.App.objects.get(pk=app_pk)
    form = forms.ArcForm(app, request.POST)
    if delete == 0:
        if form.is_valid() and form.save(app):
            return HttpResponse(helpers.make_graph(app))
    elif form.is_valid():
        for arc in models.Arc.objects.filter(
            app=app,
            rdg_from_id=form.cleaned_data["rdg_from"],
            rdg_to_id=form.cleaned_data["rdg_to"],
        ):
            arc.delete()
        return HttpResponse(helpers.make_graph(app))
    return HttpResponse(status=204)


@login_required
@require_http_methods(["GET", "POST"])
def upload_tei_collation(request: HttpRequest, section_pk: int):
    if request.method == "GET":
        form = forms.TeiCollationFileForm()
        context = {"form": form, "section_pk": section_pk}
        return render(request, "transcriptions/_upload_tei.html", context)
    else:
        form = forms.TeiCollationFileForm(request.POST, request.FILES)
        if form.is_valid():
            try:
                # tei_file: str = form.cleaned_data['tei_file'].read().decode('utf-8', errors='ignore')
                tei_file = form.cleaned_data["tei_file"]
            except:
                return render(
                    request,
                    "scraps/quick_message.html",
                    {
                        "message": "Error reading file. Was that an XML file?",
                        "timout": "60",
                    },
                )
            tei_file_name = f'/tmp/{request.user.username}/{request.FILES["tei_file"].name}.xml'  # type: ignore
            import_collation.import_tei(
                tei_file, tei_file_name, section_pk, request.user.pk
            )
            context = {
                "message": "File uploaded and added to processing queue. You can check the status in home page.",
                "timout": "3",
            }
            return render(request, "scraps/quick_message.html", context)
        else:
            context = {"form": form, "section_pk": section_pk}
            return render(request, "collation/upload_tei.html", context)


@login_required
@require_safe
def download_tei_ab(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.get(pk=ab_pk)
    tei = ab.as_tei()
    response = HttpResponse(tei, content_type="text/xml")
    response["Content-Disposition"] = f"attachment; filename={ab.name}.xml"
    return response


@login_required
@require_safe
def download_tei_section(request: HttpRequest, section_pk: int):
    section = models.Section.objects.get(pk=section_pk)
    tei = section.as_tei()
    response = HttpResponse(tei, content_type="text/xml")
    response["Content-Disposition"] = f"attachment; filename={section.name}.xml"
    return response


@login_required
@require_safe
def download_tei_collation(request: HttpRequest, collation_pk: int):
    collation = models.Collation.objects.filter(user=request.user).get(pk=collation_pk)
    tei = collation.as_tei()
    response = HttpResponse(tei, content_type="text/xml")
    response["Content-Disposition"] = f"attachment; filename={collation.name}.xml"
    return response


@login_required
@require_http_methods(["GET", "POST"])
def reading_note(request: HttpRequest, rdg_pk: int):
    rdg = models.Rdg.objects.get(pk=rdg_pk)
    if request.method == "GET":
        form = forms.RdgNoteForm(instance=rdg)
        context = {"form": form, "instance": rdg, "title": "Reading"}
        return render(request, "collation/draggable_note.html", context)
    else:
        form = forms.RdgNoteForm(request.POST, instance=rdg)
        if form.is_valid():
            form.save()
            context = {"form": form, "instance": rdg, "title": "Reading"}
            block = render_block_to_string(
                "collation/draggable_note.html", "inner", context
            )
            return HttpResponse(block)
        else:
            context = {"form": form, "instance": rdg, "title": "Reading"}
            block = render_block_to_string(
                "collation/draggable_note.html", "inner", context
            )
            return HttpResponse(block)


@login_required
@require_safe
def rdg_history(request: HttpRequest, rdg_pk: int):
    rdg = models.Rdg.objects.get(pk=rdg_pk)
    context = {"rdg": rdg, "history": rdg.history.all()}
    return render(request, "collation/rdg_history.html", context)


@login_required
@require_http_methods(["POST"])
def restore_rdg(request: HttpRequest, rdg_pk: int, history_pk: int):
    rdg = models.Rdg.objects.get(pk=rdg_pk)
    history = rdg.history.get(pk=history_pk)
    history.restore()
    app = models.App.objects.get(pk=rdg.app.pk)
    context = {
        "app": app,
        "arc_form": forms.ArcForm(models.App.objects.get(pk=app.pk)),
        "local_stemma": helpers.make_graph(models.App.objects.get(pk=app.pk)),
        "rdgs": app.rdgs.filter(witDetail=False),
        "witDetails": app.rdgs.filter(witDetail=True),
    }
    return render(request, "collation/_rdgs_table.html", context)


@login_required
@require_http_methods(["GET", "POST"])
def ab_note(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.get(pk=ab_pk)
    if request.method == "GET":
        form = forms.AbNoteForm(instance=ab)
        context = {"form": form, "instance": ab, "title": ""}
        return render(request, "collation/draggable_note.html", context)
    else:
        form = forms.AbNoteForm(request.POST, instance=ab)
        if form.is_valid():
            form.save()
            context = {"form": form, "instance": ab, "title": ""}
            block = render_block_to_string(
                "collation/draggable_note.html", "inner", context
            )
            return HttpResponse(block)
        else:
            context = {"form": form, "instance": ab, "title": ""}
            block = render_block_to_string(
                "collation/draggable_note.html", "inner", context
            )
            return HttpResponse(block)
