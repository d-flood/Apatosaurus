from os import name

from django.core.files.base import ContentFile
from zappa.asynchronous import task

from accounts.models import JobStatus, UserFile
from collation.models import Ab, Collation, Section


@task
def download_apparatus_task(corpus_type: str, user_pk: int, corpus_pk: int):
    """Generate a TEI collation file for either a Section or a Collation object."""
    if corpus_type == "section":
        corpus = Section.objects.get(pk=corpus_pk)
    elif corpus_type == "collation":
        corpus = Collation.objects.get(pk=corpus_pk)
    else:
        raise ValueError("Invalid corpus type.")
    job_pk = JobStatus.objects.create(
        user_id=user_pk,
        in_progress=True,
        progress=0,
        name=f"Generate TEI for {corpus.name}",
        message="Starting task...",
    ).pk
    try:
        tei = corpus.as_tei(job_pk).encode("utf-8")
        JobStatus.objects.filter(pk=job_pk).update(
            progress=100,
            message="Created TEI, adding to your files...",
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f"Error: {e}",
        )
        return
    try:
        UserFile(
            user_id=user_pk,
            name=f"{corpus.name}.xml",
            file=ContentFile(tei, name=f"{corpus.name}.xml"),
        ).save()
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            completed=True,
            message="TEI file added to your files.",
        )
    except Exception as e:
        JobStatus.objects.filter(pk=job_pk).update(
            in_progress=False,
            failed=True,
            message=f"Error: {e}",
        )
    return
