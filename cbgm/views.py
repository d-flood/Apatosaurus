from threading import Thread

from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.http import HttpRequest, HttpResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string

from accounts.models import JobStatus
from CONFIG.settings import BASE_DIR
from collation.models import Section
from collation.py.helpers import quick_message
from cbgm import models
from cbgm import forms
from cbgm.py.open_cbgm_interface import import_tei_section_task, compare_witnesses as compare_witnesses_task
from cbgm.py.custom_sql import get_all_witness_siglums
from witnesses.py.sort_ga_witnesses import sort_ga_witnesses



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
    Thread(target=import_tei_section_task, args=(request.user.pk, section_pk, db.pk, job.pk)).start()
    return HttpResponse(quick_message('Collation Export to the CBGM Enqueued. You can track this under "Background Tasks" in your profile.', 'ok'))


# @login_required
# @require_http_methods(['POST'])
# def send_section_for_import(request: HttpRequest, section_pk) -> HttpResponse:
#     section = Section.objects.get(pk=section_pk)
#     job = JobStatus.objects.create(
#         user=request.user,
#         name=f'Importing {section.name} into open-cbgm',
#         message='Enqueued',
#     )
#     Thread(target=import_tei_section_task, args=(request.user.pk, section_pk, , job.pk)).start()
#     return HttpResponse(quick_message(
#         """Import enqueued. This may take a while. You can monitor the progress in the "Background Jobs" section of your <a href="/accounts/profile/" >profile</a>.""", 
#         'ok',
#         timeout=60,
#         ))


@login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def edit_db(request: HttpRequest, db_pk: int):
    db = models.Cbgm_Db.objects.get(pk=db_pk)
    if request.method == 'GET':
        witnesses = db.witnesses
        witness_options = [(w, w) for w in witnesses] #type: ignore
        return render(request, 'cbgm/activated_db.html', {
            'db': db,
            'form': forms.UpdateCbgmDbForm(instance=db),
            'sorted_witnesses': witnesses,
            'sorted_app_labels': db.sorted_app_labels(),
            'compare_wits_form': forms.CompareWitnessesForm(all_witnesses=witness_options),
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
        comparison = compare_witnesses_task(db, form.cleaned_data['witness'], form.cleaned_data['comparative_witnesses'])
        return render(request, 'cbgm/compare_witnesses.html', {'json': comparison})
    return HttpResponse(status=204)
