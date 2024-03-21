from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_safe

from content.models import AboutPage, Announcement


@require_safe
def index(request: HttpRequest, slug: str = "") -> HttpResponse:
    if slug:
        about_page = get_object_or_404(AboutPage, slug=slug)
    else:
        if not (about_page := AboutPage.objects.first()):
            raise Http404('The "About" page is missing. That is my problem, not yours.')
        return redirect(reverse("about", kwargs={"slug": about_page.slug}))
    context = {
        "page": {
            "description": "A Web Application for visualizing, editing, analyzing, and publishing digital collations of ancient texts.",
            "active": "about",
            "title": f"Apatosaurus - {about_page.title}",
        },
        "about_page": about_page,
        "about_active": slug,
        "pages": AboutPage.objects.all(),
    }
    template = "about.html" if about_page.page_type == "normal" else "presentation.html"
    return render(request, template, context)


@require_safe
def announcements(request: HttpRequest):
    context = {
        "page": {
            "description": "News and updates about Apatosaurus.",
            "active": "announcements",
            "title": "Apatosaurus - Announcements",
        },
        "announcements": Announcement.objects.filter(published=True),
    }
    resp = render(request, "announcements.html", context)
    if request.user.is_authenticated and request.user.has_unread_announcements:
        request.user.has_unread_announcements = False
        request.user.save()
    return resp
