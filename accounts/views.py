from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string 
from accounts import models


@login_required
@require_safe
def profile(request: HttpRequest) -> HttpResponse:
    context = {
        'page': {'title': 'Your Profile', 'active': 'profile'},
        'jobs': request.user.job_statuses.all(), #type: ignore
    }
    return render(request, 'accounts/profile.html', context)


@login_required
@require_safe
def get_user_joblist(request: HttpRequest):
    jobs = models.JobStatus.objects.filter(user=request.user).order_by('-created')
    job_list = render_block_to_string('accounts/profile.html', 'user_job_list', {'jobs': jobs})
    return HttpResponse(job_list)


@login_required
@require_http_methods(['DELETE'])
def delete_job_status(request: HttpRequest, job_pk: int):
    job = models.JobStatus.objects.get(pk=job_pk)
    if job.user == request.user:
        job.delete()
    return HttpResponse(status=204)
