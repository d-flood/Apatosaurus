import json

from zappa.asynchronous import task

from accounts.models import JobStatus
from cbgm.py import open_cbgm_interface as cbgm
from cbgm import models


@task
def import_tei_task(user_pk: int, section_pk: int, db_pk: int, corpus_type: int):
    job_pk = JobStatus.objects.create(
        user_id=user_pk,
        in_progress=True,
        progress=-1,
        message='Importing TEI into open-cbgm'
    ).pk
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True,
        progress=-1,
        message='Importing TEI into open-cbgm'
    )
    try:
        cbgm.import_tei(user_pk, section_pk, db_pk, corpus_type)
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message='Imported TEI into open-cbgm'
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f'Error: {e}'
        )
        models.Cbgm_Db.objects.get(pk=db_pk).delete()


@task
def global_stemma_task(job_pk, db_pk: int, data: dict):
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True,
        progress=-1,
        message='Calculating global stemma'
    )
    try:
        result, svg = cbgm.print_global_stemma(db_pk, data)
        if not result:
            JobStatus.objects.filter(pk=job_pk).update(
                in_progress=False,
                failed=True,
                message=f'Error: {svg}'
            )
            return
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message='Calculated global stemma',
            data = svg
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f'Error: {e}'
        )


@task
def textual_flow_task(job_pk, db_pk: int, data: dict):
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True,
        progress=-1,
        message='Calculating textual flow'
    )
    # try:
    result, svg, title = cbgm.print_textual_flow(db_pk, data)
    if not result:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f'Error: {svg}'
        )
        return
    payload = {
        'svgs': svg,
        'title': title
    }
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=False,
        completed=True,
        progress=100,
        message='Calculated global stemma',
        data = json.dumps(payload, ensure_ascii=False),
        textual_flow = True
    )
    # except Exception as e:
    #     JobStatus.objects.filter(pk=job_pk).update(
    #         in_progress=False,
    #         failed=True,
    #         message=f'Error: {e}'
    #     )
