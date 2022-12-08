from accounts.models import JobStatus


def update_status(
    job_pk: int, 
    message: str,
    progress: int = 0,
    in_progress: bool = True,
    completed: bool = False,
    failed: bool = False,
):
    JobStatus.objects.filter(pk=job_pk).update(
        message=message,
        progress=progress,
        in_progress=in_progress,
        completed=completed,
        failed=failed,
    )