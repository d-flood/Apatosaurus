from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.http import HttpRequest, HttpResponse, Http404
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_safe
from django.urls import reverse

from content.models import AboutPage


@require_safe
def index(request: HttpRequest, slug: str = '') -> HttpResponse:
    if slug:
        about_page = get_object_or_404(AboutPage, slug=slug)
    else:
        if not (about_page := AboutPage.objects.first()):
            raise Http404('The "About" page is missing. That is my problem, not yours.')
        return redirect(reverse('about', kwargs={'slug': about_page.slug}))
    context = {
        'page': {
            'description': 'A Web Application for visualizing, editing, analyzing, and publishing digital collations of ancient texts.',
            'active': 'about',
            'title': f'Apatosaurus - About - {about_page.title}',
        },
        'about_page': about_page,
        'about_active': slug,
        'pages': AboutPage.objects.all(),
    }
    return render(request, 'about.html', context)
