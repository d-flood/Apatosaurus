from huey.contrib.djhuey import task

from accounts.models import JobStatus
from cbgm.py import open_cbgm_interface as cbgm
from cbgm import models


@task()
def import_tei_task(user_pk: int, section_pk: int, db_pk: int, job_pk: int, corpus_type: int):
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