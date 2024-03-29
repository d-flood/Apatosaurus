from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods, require_safe
from render_block import render_block_to_string

from accounts import forms, models


@login_required
@require_safe
def profile(request: HttpRequest) -> HttpResponse:
    context = {
        "page": {"title": "Your Profile", "active": "profile"},
        "jobs": request.user.job_statuses.all(),  # type: ignore
        "files": request.user.user_files.all(),  # type: ignore
        "user_change_form": forms.CustomUserChangeForm(instance=request.user),
    }
    return render(request, "accounts/profile.html", context)


@login_required
@require_safe
def get_user_joblist(request: HttpRequest):
    jobs = models.JobStatus.objects.filter(user=request.user).order_by("-created")
    job_list = render_block_to_string(
        "accounts/profile.html", "user_job_list", {"jobs": jobs}
    )
    return HttpResponse(job_list)


@login_required
@require_http_methods(["DELETE"])
def delete_job_status(request: HttpRequest, job_pk: int):
    job = models.JobStatus.objects.get(pk=job_pk)
    if job.user == request.user:
        job.delete()
    return HttpResponse(status=204)


@login_required
@require_http_methods(["POST"])
def update_user(request: HttpRequest):
    form = forms.CustomUserChangeForm(request.POST, instance=request.user)
    resp = HttpResponse(status=204)
    if form.is_valid():
        form.save()
        resp["HX-Trigger"] = (
            """{"showDialog": {"title": "Succes", "message": "User Information Updated"}}"""
        )
        return resp
    resp["HX-Trigger"] = (
        """{"showDialog": {"title": "Succes", "message": "User Information Updated"}}"""
    )
    return resp


@login_required
@require_http_methods(["DELETE"])
def delete_user_file(request: HttpRequest, file_pk: int):
    file = models.UserFile.objects.filter(user=request.user, pk=file_pk).first()
    if file:
        file.delete()
    return HttpResponse("")
