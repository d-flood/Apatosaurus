import json

from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.http import HttpRequest, HttpResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation import models as cx_models
from cbgm import models, forms
from cbgm.py import open_cbgm_interface as cbgm
from cbgm.py.custom_sql import get_all_witness_siglums, get_readings_for_variation_unit
from cbgm.py.helpers import extract_app_groups
from witnesses.py.sort_ga_witnesses import sort_ga_witnesses


# resp['HX-Trigger'] = '''{"showDialog": {"title": "the title", "message": "the message"}}'''


@require_safe
def main(request: HttpRequest) -> HttpResponse:
    if request.user.is_authenticated:
        return render(request, 'cbgm/index.html', {
            'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
            'entire_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=2, active=True),
            'section_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=1, active=True),
            'verse_dbs': models.Cbgm_Db.objects.filter(user=request.user, amount=0, active=True),
        })
    return render(request, 'cbgm/index.html', {
        'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
    })


@login_required
@require_http_methods(['GET', 'POST'])
def send_section_form(request: HttpRequest, corpus_pk: int, corpus_type: int):
    if corpus_type == 0:
        new_db_html = 'cbgm/new_cbgm_db.html'
        corpus_instance = cx_models.Ab.objects.get(pk=corpus_pk)
    elif corpus_type == 1:
        new_db_html = 'cbgm/new_cbgm_db.html'
        corpus_instance = cx_models.Section.objects.get(pk=corpus_pk)
    elif corpus_type == 2:
        new_db_html = 'cbgm/new_cbgm_db.html'
        corpus_instance = cx_models.Collation.objects.get(pk=corpus_pk)
    else:
        return render(request, 'scraps/quick_message.html', {'message': 'Invalid corpus type', 'timeout': 4})

    context = {
        'page': {'title': 'Apatosaurus - open-cbgm', 'active': 'open-cbgm'},
        'corpus': corpus_instance,
        'corpus_type': corpus_type,
    }
    if request.method == 'GET':
        context['form'] = forms.Cbgm_DbForm()
        return render(request, new_db_html, context)
    form = forms.Cbgm_DbForm(request.POST, user_pk=request.user.pk)
    if not form.is_valid():
        context['form'] = form
        return render(request, new_db_html, context)
    job = JobStatus.objects.create(
        user=request.user,
        name=f'Importing {corpus_instance.name} into open-cbgm',
        message='Enqueued',
    )
    db = form.save(corpus_type)
    # tasks.import_tei_task(request.user.pk, corpus_pk, db.pk, job.pk, corpus_type)
    return render(request, 'scraps/quick_message.html', {'message': 'Collation Export to the CBGM Enqueued. You can track this under "Background Tasks" in your profile. Note that large collations will usually take 1 to 2 second per witness including correctors.', 'timeout': 4})


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
        resp = render(request, 'scraps/quick_message.html', {'message': 'Database updated', 'timeout': 4})
        resp['HX-Trigger'] = 'refreshDbs'
        return resp
    else:
        db.delete()
        resp = render(request, 'scraps/quick_message.html', {'message': 'Database deleted', 'timeout': 4})
        resp['HX-Trigger'] = 'refreshDbs'
        return resp


@login_required
@require_safe
def refresh_dbs(request: HttpRequest) -> HttpResponse:
    return HttpResponse(render_block_to_string('cbgm/manage_db.html', 'db_options', {
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
    witness_options = [(w, w) for w in db.witnesses] # type: ignore
    # witness_options = [(w, w) for w in get_all_witness_siglums(db.db_file.path)]
    form = forms.CompareWitnessesForm(request.POST, all_witnesses=witness_options)
    if form.is_valid():
        comparison = cbgm.compare_witnesses(db, form.cleaned_data['witness'], form.cleaned_data['comparative_witnesses'])
        return render(request, 'cbgm/compare_witnesses.html', {'json': comparison})
    return HttpResponse(status=204)


@login_required
@require_http_methods(['POST'])
def find_relatives(request: HttpRequest, db_pk: int) -> HttpResponse:
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    cached_db = cbgm.get_cached_db(db).resolve().as_posix()
    all_witnesses = get_all_witness_siglums(cached_db)
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
    cached_db = cbgm.get_cached_db(db).resolve().as_posix()
    rdgs = get_readings_for_variation_unit(cached_db, variation_unit)
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
        job = JobStatus.objects.create(
            user=request.user,
            name=f'Generating Textual Flow',
            message='Enqueued',
            textual_flow=True,
        )
        request.session['svg_task'] = job.pk
        # tasks.textual_flow_task(db.pk, form.cleaned_data, job.pk)

        resp = HttpResponse(status=204)
        resp['HX-Trigger'] = 'textualFlowTaskStarted'
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
        job = JobStatus.objects.create(
            user=request.user,
            name=f'Generating Global Stemma',
            message='Enqueued',
        )
        job.save()
        request.session['svg_task'] = job.pk
        # tasks.global_stemma_task(db.pk, form.cleaned_data, job.pk)
        
        resp = HttpResponse(status=204)
        resp['HX-Trigger'] = 'svgTaskStarted'
        return resp
    else:
        print(form.errors)
        # retarget to #global-stemma-form and return rendered form block; context: db, global_stemma_form
        return HttpResponse(status=204)
        # TODO: retarget to #global-stemma-form and return rendered form block; context: db, global_stemma_form


@login_required
@require_safe
def get_svg_task_status(request: HttpRequest):
    job_id = request.session.get('svg_task')
    if not job_id:
        resp = HttpResponse(status=204)
        resp['HX-Trigger'] = '''{"showDialog": {"title": "No Task", "message": "There is no task running or completed for this operation."}}'''
        return resp
    job = JobStatus.objects.get(pk=job_id)
    if job.completed:
        if job.textual_flow:
            resp = render(request, 'cbgm/textual_flow.html', {'result': json.loads(job.data)})
        else:
            resp = render(request, 'cbgm/global_stemma.html', {'svg': job.data})
        resp['HX-Trigger'] = 'svgTaskCompleted'
        del request.session['svg_task']
        return resp
    elif job.failed:
        resp = HttpResponse(status=204)
        resp['HX-Trigger'] = f'{{"showDialog": {{"title": "Error", "message": "{job.message}"}}}}'
        return resp
    else:
        return HttpResponse(status=204)
