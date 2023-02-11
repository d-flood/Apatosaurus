from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string

from collation import models as cmodels
from accounts.models import CustomUser
from collation.py import helpers as chelpers


def main(request):
    user_model = get_user_model()
    # TODO: sort this somehow... (traditional biblical order? Alaphabetical?)
    collations = cmodels.Collation.objects.filter(sections__published=True).distinct()
    users_with_published_sections = user_model.objects.filter(collations__sections__published=True).distinct()
    context = {
        'page': {'active': 'published'},
        'collations': collations,
        'published_editors': users_with_published_sections,
    }
    return render(request, 'published/main.html', context)


def browse_collation(request: HttpRequest, collation_pk: int, user_pk: int = False) -> HttpResponse:
    editor = CustomUser.objects.get(id=user_pk) if user_pk else None
    collation = cmodels.Collation.objects.get(id=collation_pk)
    if collation.sections.filter(published=True).count() == 0: #type: ignore
        return HttpResponse(status=404)
    published_sections = collation.sections.filter(published=True) #type: ignore
    context = {
        'page': {'active': 'published'},
        'collation': collation,
        'sections': published_sections,
        'editor': editor,
    }
    return render(request, 'published/browse_collation.html', context)


def browse_section(request: HttpRequest, section_pk: int, user_pk: int = False) -> HttpResponse:
    editor = CustomUser.objects.get(id=user_pk) if user_pk else None
    section = cmodels.Section.objects.get(id=section_pk)
    if not section.published:
        return HttpResponse(status=404)
    context = {
        'page': {'active': 'published'},
        'section': section,
        'editor': editor,
    }
    return render(request, 'published/browse_section.html', context)


def browse_editor(request: HttpRequest, user_pk: int) -> HttpResponse:
    user = CustomUser.objects.get(id=user_pk)
    if user.collations.filter(sections__published=True).count() == 0: #type: ignore
        return HttpResponse(status=404)
    published_collations = user.collations.filter(sections__published=True).distinct() #type: ignore
    context = {
        'page': {'active': 'published'},
        'editor': user,
        'collations': published_collations,
    }
    return render(request, 'published/browse_editor.html', context)


def apparatus(request: HttpRequest, ab_pk: int, user_pk: int = False) -> HttpResponse:
    editor = CustomUser.objects.get(id=user_pk) if user_pk else None
    ab = cmodels.Ab.objects.get(id=ab_pk)
    if not ab.section.published:
        return HttpResponse(status=404)
    
    context = {
        'page': {'active': 'published'},
        'ab': ab,
        'editor': editor,
        'section': ab.section,
        'selected_ab': ab.name,
    }
    if request.htmx: #type: ignore
        html = render_block_to_string('published/apparatus.html', 'inner_content', request=request, context=context)
        resp = HttpResponse(html)
        print('HTMX')
    else:
        resp = render(request, 'published/apparatus.html', context)
        print('BROWSER')
    return resp


def rdgs(request: HttpRequest, app_pk: int):
    app = cmodels.App.objects.get(pk=app_pk)
    rdgs = app.rdgs.filter(witDetail=False)
    witDetails = app.rdgs.filter(witDetail=True)
    context = {
        'rdgs': rdgs,
        'witDetails': witDetails,
        'local_stemma': chelpers.make_graph(app),
    }
    return render(request, 'published/rdgs.html', context)
