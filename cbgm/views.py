from threading import Thread

from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.http import HttpRequest, HttpResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_safe

from rich import print

from render_block import render_block_to_string

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation.models import Section
from collation.py.helpers import quick_message
from cbgm import models
from cbgm import forms
from cbgm.py import open_cbgm_interface as cbgm
from cbgm.py.custom_sql import get_all_witness_siglums, get_readings_for_variation_unit
from cbgm.py.helpers import extract_app_groups
from witnesses.py.sort_ga_witnesses import sort_ga_witnesses


# resp['HX-Trigger'] = '''{"showDialog": {"title": "the title", "message": "the message"}}'''


@login_required
@require_safe
def main(request: HttpRequest) -> HttpResponse:
    return render(request, 'cbgm/index.html', {
        'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
        'entire_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=2, active=True),
        'section_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=1, active=True),
        'verse_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=0, active=True),
    })


@login_required
@require_http_methods(['GET', 'POST'])
def send_section_form(request: HttpRequest, section_pk: int):
    if request.method == 'GET':
        return render(request, 'cbgm/new_cbgm_section_db.html', {
            'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
            'section': Section.objects.get(pk=section_pk),
            'form': forms.Cbgm_DbForm(),
        })
    form = forms.Cbgm_DbForm(request.POST)
    if not form.is_valid():
        return render(request, 'cbgm/new_cbgm_section_db.html', {
            'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
            'section': Section.objects.get(pk=section_pk),
            'form': form,
        })
    section = Section.objects.get(pk=section_pk)
    job = JobStatus.objects.create(
        user=request.user,
        name=f'Importing {section.name} into open-cbgm',
        message='Enqueued',
    )
    db = form.save(request.user.pk, 1)
    Thread(target=cbgm.import_tei_section_task, args=(request.user.pk, section_pk, db.pk, job.pk)).start()
    return HttpResponse(quick_message('Collation Export to the CBGM Enqueued. You can track this under "Background Tasks" in your profile.', 'ok'))


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_db(request: HttpRequest, db_pk: int):
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    if request.method == 'GET':
        witnesses = db.witnesses
        witness_options = [(w, w) for w in witnesses] #type: ignore
        app_labels = db.sorted_app_labels()
        app_choices = [(a, a) for a in app_labels]
        app_groups = extract_app_groups(app_labels)
        return render(request, 'cbgm/activated_db.html', {
            'db': db,
            'form': forms.UpdateCbgmDbForm(instance=db),
            'sorted_witnesses': witnesses,
            'sorted_app_labels': app_labels,
            'compare_wits_form': forms.CompareWitnessesForm(all_witnesses=witness_options),
            'find_relatives_form': forms.FindRelativesForm(all_witnesses=witness_options, app_labels=app_choices),
            'app_groups': app_groups,
            'optimize_substemma_form': forms.OptimizeSubstemmaForm(all_witnesses=witness_options),
            'local_stemma_form': forms.LocalStemmaForm(app_labels=app_choices),
            'textual_flow_form': forms.TextualFlowForm(app_labels=app_choices),
            'global_stemma_form': forms.GlobalStemmaForm(),
        })
    elif request.method == 'POST':
        form = forms.UpdateCbgmDbForm(request.POST, instance=db)
        if not form.is_valid():
            return render(request, 'cbgm/activated_db.html', {
                'db': db,
                'form': form,
            })
        form.save()
        resp = HttpResponse(quick_message('Database updated', 'ok'))
        resp['HX-Trigger'] = 'refreshDbs'
        return resp
    else:
        db.delete()
        resp = HttpResponse(quick_message('Database deleted', 'warn'))
        resp['HX-Trigger'] = 'refreshDbs'
        return resp


@login_required
@require_safe
def refresh_dbs(request: HttpRequest) -> HttpResponse:
    return HttpResponse(render_block_to_string('cbgm/index.html', 'db_options', {
        'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
        'entire_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=2),
        'section_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=1),
        'verse_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=0),
    }))


@login_required
@require_http_methods(['POST'])
def set_active_db(request: HttpRequest, db_pk: int) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    request.session['active_db'] = {'pk': db.pk, 'name': db.db_name}
    resp = HttpResponse(status=204)
    resp['HX-Refresh'] = 'true'
    return resp


@login_required
@require_http_methods(['POST'])
def compare_witnesses(request: HttpRequest, db_pk: int) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    # witness_options = [(w, w) for w in db.sorted_witnesses()] # type: ignore
    witness_options = [(w, w) for w in get_all_witness_siglums(db.db_file.path)]
    form = forms.CompareWitnessesForm(request.POST, all_witnesses=witness_options)
    if form.is_valid():
        comparison = cbgm.compare_witnesses(db, form.cleaned_data['witness'], form.cleaned_data['comparative_witnesses'])
        return render(request, 'cbgm/compare_witnesses.html', {'json': comparison})
    return HttpResponse(status=204)


@login_required
@require_http_methods(['POST'])
def find_relatives(request: HttpRequest, db_pk: int) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    all_witnesses = get_all_witness_siglums(db.db_file.path)
    all_witnesses = sort_ga_witnesses(all_witnesses)
    all_witnesses = [(w, w) for w in all_witnesses]
    app_labels = [(w, w) for w in db.sorted_app_labels()]
    form = forms.FindRelativesForm(request.POST, all_witnesses=all_witnesses, app_labels=app_labels)
    if form.is_valid():
        rdgs = request.POST.getlist('variation-unit-readings')
        relatives = cbgm.find_relatives(db, form.cleaned_data['witness'], form.cleaned_data['app_labels'], rdgs)
        return render(request, 'cbgm/find_relatives.html', {'json': relatives})
    return HttpResponse(status=204)


@login_required
@require_safe
def get_rdgs_for_app(request: HttpRequest, db_pk: int, variation_unit: str) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    rdgs = get_readings_for_variation_unit(db.db_file.path, variation_unit)
    return render(request, 'cbgm/rdgs.html', {'rdgs': rdgs})


@login_required
@require_http_methods(['POST'])
def optimize_substemma(request: HttpRequest, db_pk: int) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    witness_options = [(w, w) for w in db.witnesses] #type: ignore
    form = forms.OptimizeSubstemmaForm(request.POST, all_witnesses=witness_options)
    if form.is_valid():
        successful, substemma = cbgm.optimize_substemma(
            db=db, witness=form.cleaned_data['witness'], 
            max_cost=form.cleaned_data['max_cost']
        )
        if successful:
            return render(request, 'cbgm/optimize_substemma.html', {'json': substemma})
        resp = HttpResponse(status=204)
        resp['HX-Trigger'] = f'{{"showDialog": {substemma}}}'
        return resp
    return HttpResponse(status=204)


@login_required
@require_safe
def local_stemma(request: HttpRequest, db_pk: int, variation_unit: str) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    successful, svg = cbgm.print_local_stemma(
        db=db, app=variation_unit,
    )
    if successful:
        return render(request, 'cbgm/local_stemma.html', {'svg': svg, 'app': variation_unit})
    resp = HttpResponse(status=204)
    resp['HX-Trigger'] = f'{{"showDialog": {{"title": "Error", "message": "No local stemma found for this variation unit."}}}}'
    return resp


@login_required
@require_http_methods(['POST'])
def textual_flow(request: HttpRequest, db_pk: int):
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    app_labels = [(w, w) for w in db.sorted_app_labels()]
    form = forms.TextualFlowForm(request.POST, app_labels=app_labels)
    if form.is_valid():
        successful, output, title = cbgm.print_textual_flow(db=db, data=form.cleaned_data)
        if successful:
            return render(request, 'cbgm/textual_flow.html', {'output': output, 'title': title})
        else:
            resp = HttpResponse(status=204)
            resp['HX-Trigger'] = f'{{"showDialog": {output}}}'
            return resp
    else:
        print(form.errors)
        # TODO: retarget to #textual-flow-form and return rendered form block; context: db, textual_flow_form
        return HttpResponse(status=204)



@login_required
@require_http_methods(['POST'])
def global_stemma(request: HttpRequest, db_pk: int):
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    form = forms.GlobalStemmaForm(request.POST)
    if form.is_valid():
        successful, output = cbgm.print_global_stemma(db=db, data=form.cleaned_data)
        if successful:
            return render(request, 'cbgm/global_stemma.html', {'svg': output})
        else:
            resp = HttpResponse(status=204)
            resp['HX-Trigger'] = f'{{"showDialog": {output}}}'
            return resp
    else:
        print(form.errors)
        # retarget to #global-stemma-form and return rendered form block; context: db, global_stemma_form
        return HttpResponse(status=204)
        # TODO: retarget to #global-stemma-form and return rendered form block; context: db, global_stemma_form

