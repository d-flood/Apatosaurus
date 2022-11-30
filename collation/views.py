from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string 

from collation import forms
from collation import models
from collation.py import helpers


@login_required
def main(request):
    context = {
        'page': {'active': 'collation', 'title': 'Apatosaurus - Collation'},
    }
    return render(request, 'collation/main.html', context)


@login_required
@require_http_methods(['GET', 'POST'])
def new_colation(request: HttpRequest):
    if request.method == 'GET':
        form = forms.CollationForm()
        context = {
            'page': {'active': 'collation'},
            'new_collation_form': forms.CollationForm()
        }
        return render(request, 'collation/new_collation.html', context)
    else:
        form = forms.CollationForm(request.POST)
        if form.is_valid():
            form.save(request.user)
        return render(request, 'collation/new_collation.html', {'page': {'active': 'collation'}})


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_collation(request: HttpRequest, collation_id: int):
    collation = models.Collation.objects.get(pk=collation_id)
    if request.method == 'GET':
        form = forms.CollationForm(instance=collation)
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'collation': collation,
        }
        return render(request, 'collation/edit_collation.html', context)
    elif request.method == 'POST':
        form = forms.CollationForm(request.POST, instance=collation)
        if form.is_valid():
            form.save(request.user)
            resp = HttpResponse()
            resp['HX-Redirect'] = '/collation'
            return resp
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'collation': collation,
        }
        return render(request, 'collation/edit_collation.html', context)
    else:
        collation.delete()
        resp = HttpResponse()
        resp['HX-Redirect'] = '/collation'
        return resp


@login_required
@require_http_methods(['GET', 'POST'])
def new_section(request: HttpRequest, collation_id: int):
    if request.method == 'GET':
        form = forms.SectionForm()
        context = {
            'page': {'active': 'collation'},
            'new_section_form': forms.SectionForm(),
            'collation_id': collation_id
        }
        return render(request, 'collation/new_section.html', context)
    else:
        form = forms.SectionForm(request.POST)
        if form.is_valid():
            form.save(collation_id)
            resp = HttpResponse(helpers.quick_message('Section/Chapter created', 'ok'))
            resp['HX-Trigger'] = 'refreshSections'
            return resp
        return render(request, 'collation/new_section.html', {'page': {'active': 'collation'}})


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_section(request: HttpRequest, section_id: int):
    if request.method == 'GET':
        section = models.Section.objects.get(pk=section_id)
        form = forms.SectionForm(instance=section)
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'section': section
        }
        return render(request, 'collation/edit_section.html', context)
    elif request.method == 'POST':
        section = models.Section.objects.get(pk=section_id)
        form = forms.SectionForm(request.POST, instance=section)
        if form.is_valid():
            form.save(section.collation.pk)
            return HttpResponse('Section saved')
        return render(request, 'collation/edit_section.html', {'page': {'active': 'collation'}})
    else:
        section = models.Section.objects.get(pk=section_id)
        section.delete()
        resp = HttpResponse(helpers.quick_message('Section deleted', 'warn', 3))
        resp['HX-Trigger'] = 'refreshSections'
        return resp


@login_required
@require_http_methods(['GET', 'POST'])
def new_ab(request: HttpRequest, section_id: int):
    if request.method == 'GET':
        form = forms.AbForm()
        context = {
            'page': {'active': 'collation'},
            'new_ab_form': forms.AbForm(),
            'section_id': section_id
        }
        return render(request, 'collation/new_ab.html', context)
    else:
        form = forms.AbForm(request.POST)
        if form.is_valid():
            form.save(section_id)
            resp =  HttpResponse(helpers.quick_message('Collation unit saved', 'ok', 3))
            resp['HX-Trigger'] = 'refreshAbs'
            return resp
        return render(request, 'collation/new_ab.html', {'page': {'active': 'collation'}})


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_ab(request: HttpRequest, ab_pk: int):
    if request.method == 'GET':
        ab = models.Ab.objects.get(pk=ab_pk)
        form = forms.AbForm(instance=ab)
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'ab': ab
        }
        return render(request, 'collation/edit_ab.html', context)
    elif request.method == 'POST':
        ab = models.Ab.objects.get(pk=ab_pk)
        form = forms.AbForm(request.POST, instance=ab)
        if form.is_valid():
            form.save(ab.section.pk)
            resp = HttpResponse('Ab saved')
            resp['HX-Trigger'] = 'refreshAbs'
            return resp
        return render(request, 'collation/edit_ab.html', {'page': {'active': 'collation'}})
    else:
        ab = models.Ab.objects.get(pk=ab_pk)
        ab.delete()
        resp = HttpResponse(helpers.quick_message(f'{ab.ab_id} deleted', 'warn', 3))
        resp['HX-Trigger'] = 'refreshAbs'
        return resp


@login_required
@require_http_methods(['GET', 'POST'])
def new_rdg(request: HttpRequest, app_pk: int):
    if request.method == 'GET':
        form = forms.RdgForm()
        context = {
            'page': {'active': 'collation'},
            'form': forms.RdgForm(),
            'app_pk': app_pk
        }
    else:
        form = forms.RdgForm(request.POST)
        if form.is_valid():
            form.save(app_pk)
            return render(request, 'collation/rdgs_table.html', {'app': models.App.objects.get(pk=app_pk)})
        context = {
            'form': form,
            'app_pk': app_pk
        }

    return render(request, 'collation/new_rdg.html', context)


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_rdg(request: HttpRequest, rdg_pk: int):
    if request.method == 'GET':
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        form = forms.RdgForm(instance=rdg)
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'rdg': rdg
        }
        return render(request, 'collation/edit_rdg.html', context)
    elif request.method == 'POST':
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        form = forms.RdgForm(request.POST, instance=rdg)
        if form.is_valid():
            form.save(rdg.app.pk)
            return render(request, 'collation/rdgs_table.html', {'app': rdg.app})
        context = {
            'form': form,
            'rdg': rdg
        }
        return render(request, 'collation/edit_rdg.html', context)
    else:
        rdg = models.Rdg.objects.get(pk=rdg_pk)
        rdg.delete()
        return render(request, 'collation/rdgs_table.html', {'app': rdg.app})


def cancel_new_rdg(request: HttpRequest, app_pk: int):
    return render(request, 'collation/rdgs_table.html', {'app': models.App.objects.get(pk=app_pk)})


@login_required
def sections(request: HttpRequest, collation_id: int):
    context = {
        'page': {'active': 'collation'},
        'sections': models.Section.objects.filter(collation__id=collation_id),
        'collation': models.Collation.objects.get(id=collation_id)
    }
    return render(request, 'collation/sections.html', context)


@login_required
def collations(request: HttpRequest):
    context = {
        'page': {'active': 'collation'},
        'collations': models.Collation.objects.filter(user=request.user)
    }
    return render(request, 'collation/collations.html', context)


@login_required
def abs(request: HttpRequest, section_id: int):
    context = {
        'page': {'active': 'collation'},
        'abs': models.Ab.objects.filter(section__id=section_id),
        'section': models.Section.objects.get(id=section_id)
    }
    return render(request, 'collation/abs.html', context)


@login_required
@require_safe
def apparatus(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.get(pk=ab_pk)
    context = {
        'page': {'active': 'collation'},
        'ab': ab,
    }
    return render(request, 'collation/apparatus.html', context)


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_app(request: HttpRequest, ab_pk: int, app_pk: int):
    if request.method == 'GET':
        form = forms.AppForm() if app_pk == 0 else forms.AppForm(instance=models.App.objects.get(pk=app_pk))
        context = {
            'page': {'active': 'collation'},
            'form': form,
            'app_pk': app_pk,
            'ab_pk': ab_pk
        }
        return render(request, 'collation/app_form.html', context)
    elif request.method == 'POST':
        if app_pk == 0:
            form = forms.AppForm(request.POST)
        else:
            form = forms.AppForm(request.POST, instance=models.App.objects.get(pk=app_pk))
        if form.is_valid():
            app = form.save(ab_pk)
            app.ab.save()
            app_buttons = render_block_to_string('collation/apparatus.html', 'app_buttons', {'ab': models.Ab.objects.get(pk=ab_pk)})
            resp = HttpResponse(app_buttons)
            resp['HX-Trigger'] = 'refreshBasetext'
            return resp
        else:
            context = {
                'page': {'active': 'collation'},
                'form': form,
                'app_pk': app_pk,
                'ab_pk': ab_pk
            }
            return render(request, 'collation/app_form.html', context)
    else:
        app = models.App.objects.get(pk=app_pk)
        ab = app.ab
        app.delete()
        ab.save()
        app_buttons = render_block_to_string('collation/apparatus.html', 'app_buttons', {'ab': models.Ab.objects.get(pk=ab_pk)})
        resp = HttpResponse(app_buttons)
        resp['HX-Trigger'] = 'refreshBasetext'
        return resp


def cancel_edit_app(request: HttpRequest, ab_pk: int):
    app_buttons = render_block_to_string('collation/apparatus.html', 'app_buttons', {'ab': models.Ab.objects.get(pk=ab_pk)})
    return HttpResponse(app_buttons)


@login_required
@require_safe
def rdgs(request: HttpRequest, app_pk: int):
    app = models.App.objects.get(pk=app_pk)
    context = {
        'page': {'active': 'collation'},
        'app': app,
    }
    return render(request, 'collation/rdgs_table.html', context)


@login_required
@require_safe
def refresh_basetext(request: HttpRequest, ab_pk: int):
    ab = models.Ab.objects.get(pk=ab_pk)
    basetext_row = render_block_to_string('collation/apparatus.html', 'basetext_row', {'ab': ab})
    return HttpResponse(basetext_row)
