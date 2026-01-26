# TODO: refactor long running tasks

import json

from django.core.mail import EmailMessage
from peasy_jobs.peasy_jobs import peasy

from accounts.models import JobStatus
from cbgm import models
from cbgm.py import open_cbgm_interface as cbgm
from CONFIG import settings


@peasy.job("export TEI to CBGM")
def import_tei_task(section_pk: int, db_pk: int, corpus_type: int, job_pk: int, user_pk: int | None = None):
    if user_pk is ...:
        raise TypeError("user_pk is required as a keyword argument")
    peasy.update_status(job_pk, "Importing TEI into open-cbgm")
    try:
        cbgm.import_tei(user_pk=user_pk, section_pk=section_pk, db_pk=db_pk, corpus_type=corpus_type)
        peasy.update_status(job_pk, "TEI imported into open-cbgm")
    except Exception as e:
        models.Cbgm_Db.objects.get(pk=db_pk).delete()
        raise e


def global_stemma_task(job_pk, db_pk: int, data: dict):
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True, progress=-1, message="Calculating global stemma"
    )
    try:
        db = models.Cbgm_Db.objects.get(pk=db_pk)
        result, svg = cbgm.print_global_stemma(db_pk, data)
        if not result:
            JobStatus.objects.filter(pk=job_pk).update(
                in_progress=False, failed=True, message=f"Error: {svg}"
            )
            return
        if data.get("email_graph"):
            email = EmailMessage(
                subject=f"Global Stemma Diagram for {db.db_name}",
                body="Your Global Stemma Diagram is attached.",
                from_email=settings.EMAIL_HOST_USER,
                to=[JobStatus.objects.get(pk=job_pk).user.email],
                attachments=[("global_stemma.svg", svg, "image/svg+xml")],
            )
            email.send()
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message="Calculated global stemma",
            data=svg,
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False, failed=True, message=f"Error: {e}"
        )


def textual_flow_task(job_pk, db_pk: int, data: dict):
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True, progress=-1, message="Calculating textual flow"
    )
    try:
        result, svg, title = cbgm.print_textual_flow(db_pk, data)
        if not result:
            JobStatus.objects.filter(pk=job_pk).update(
                in_progress=False, failed=True, message=f"Error: {svg}"
            )
            return
        payload = {"svgs": svg, "title": title}
        if data.get("email_graph"):
            attachments = []
            for i, svg in enumerate(svg):
                attachments.append((f"textual_flow_{i}.svg", svg, "image/svg+xml"))
            email = EmailMessage(
                subject=title,
                body="Your Textual Flow Diagrams are attached.",
                from_email=settings.EMAIL_HOST_USER,
                to=[JobStatus.objects.get(pk=job_pk).user.email],
                attachments=attachments,
            )
            email.send()
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message="Calculated global stemma",
            data=json.dumps(payload, ensure_ascii=False),
            textual_flow=True,
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False, failed=True, message=f"Error: {e}"
        )

