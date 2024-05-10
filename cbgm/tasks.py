import json

import boto3
from django.core.mail import EmailMessage
from zappa.asynchronous import task

from accounts.models import JobStatus
from cbgm import models
from cbgm.py import open_cbgm_interface as cbgm
from CONFIG import settings


def import_tei_task(
    user_pk: int, section_pk: int, db_pk: int, corpus_type: int, ignore_rdg_types: list
):
    job_pk = JobStatus.objects.create(
        user_id=user_pk,
        in_progress=True,
        progress=-1,
        message="Importing TEI into open-cbgm",
    ).pk
    JobStatus.objects.filter(pk=job_pk).update(
        in_progress=True, progress=-1, message="Importing TEI into open-cbgm"
    )
    try:
        cbgm.import_tei(user_pk, section_pk, db_pk, corpus_type, ignore_rdg_types)
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            progress=100,
            message="Imported TEI into open-cbgm",
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False, failed=True, message=f"Error: {e}"
        )
        models.Cbgm_Db.objects.get(pk=db_pk).delete()


def import_tei_batch_job(
    user_pk: int, section_pk: int, db_pk: int, corpus_type: int, ignore_rdg_types: list
):
    client = boto3.client("batch")
    response = client.submit_job(
        jobName="Create-CBGM-DB",
        jobQueue="apatosaurus-long-task-job-queue",
        jobDefinition="apatosaurus-long-task-job-definition",
        containerOverrides={
            "command": [
                "python",
                "manage.py",
                "populate_cbgm_db",
                str(user_pk),
                str(section_pk),
                str(db_pk),
                str(corpus_type),
                *ignore_rdg_types,
            ]
        },
    )


@task
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


def global_stemma_batch_job(job_pk: int, db_pk: int, data: dict):
    client = boto3.client("batch")
    response = client.submit_job(
        jobName="Generate-Global-Stemma-Diagram",
        jobQueue="apatosaurus-long-task-job-queue",
        jobDefinition="apatosaurus-long-task-job-definition",
        containerOverrides={
            "command": [
                "python",
                "manage.py",
                "print_global_stemma",
                str(job_pk),
                str(db_pk),
                json.dumps(data),
            ]
        },
    )


@task
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


def textual_flow_batch_job(job_pk: int, db_pk: int, data: dict):
    client = boto3.client("batch")
    response = client.submit_job(
        jobName="Generate-Textual-Flow-Diagram",
        jobQueue="apatosaurus-long-task-job-queue",
        jobDefinition="apatosaurus-long-task-job-definition",
        containerOverrides={
            "command": [
                "python",
                "manage.py",
                "print_textual_flow",
                str(job_pk),
                str(db_pk),
                json.dumps(data),
            ]
        },
    )
