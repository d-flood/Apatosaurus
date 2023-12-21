import json
import os

import boto3
from zappa.asynchronous import task

from accounts.py.update_status import JobStatus, update_status
from collation import models
from collation.py import process_tei
from CONFIG import settings


@task
def tei_to_db(tei_file_name: str, section_id: int, user_pk: int):
    session = boto3.Session(
        aws_access_key_id=os.environ.get("AWS_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_S3_REGION_NAME"),
    )
    s3 = session.client("s3")
    tei_string = (
        s3.get_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=tei_file_name)[
            "Body"
        ]
        .read()
        .decode("utf-8")
    )
    job_pk = JobStatus.objects.create(
        user_id=user_pk,
        name=f"Import TEI Collation {models.Section.objects.get(pk=section_id).name}",
        message="Started",
    ).pk
    try:
        if (xml := process_tei.parse_xml(tei_string)) is not None:
            process_tei.tei_to_db(xml, section_id, job_pk, user_pk)
            update_status(job_pk, "", 100, False, True)
        else:
            update_status(job_pk, "Error: XML file is not valid", 0, False, False, True)
    except Exception as e:
        print(e)
        update_status(job_pk, f"Error: {e}", 0, False, False, True)
    s3.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=tei_file_name)


def import_tei(tei_file, tei_file_name: str, section_id: int, user_pk: int):
    session = boto3.Session(
        aws_access_key_id=os.environ.get("AWS_S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_S3_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_S3_REGION_NAME"),
    )
    s3 = session.client("s3")
    s3.put_object(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=tei_file_name,
        Body=tei_file.read(),
    )
    tei_to_db(tei_file_name, section_id, user_pk)
