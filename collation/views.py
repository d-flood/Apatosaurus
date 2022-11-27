from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.http import HttpRequest
from django.views.decorators.http import require_http_methods, require_safe

# from render_block import render_block_to_string #? this threw a "SafeString" error

from collation import forms
from collation import models


@login_required
def main(request):
    context = {
        'page': {'active': 'collation'}
    }
    return render(request, 'collation/main.html', context)


@login_required
@require_http_methods(['GET', 'POST'])
def new_colation(request: HttpRequest):
    if request.method == 'GET':
        form = forms.CollationForm()
        context = {
            'page': {'active': 'collation'},
            'new_collation_form': forms.CollationForm()
        }
        return render(request, 'collation/new_collation.html', context)
    else:
        form = forms.CollationForm(request.POST)
        if form.is_valid():
            form.save(request.user)
        return render(request, 'collation/new_collation.html', {'page': {'active': 'collation'}})


@login_required
def sections(request: HttpRequest, collation_id: int):
    context = {
        'page': {'active': 'collation'},
        'sections': models.Section.objects.filter(collation__id=collation_id),
        'collation_title': models.Collation.objects.get(id=collation_id).name
    }
    return render(request, 'collation/sections.html', context)


@login_required
def collations(request: HttpRequest):
    context = {
        'page': {'active': 'collation'},
        'collations': models.Collation.objects.filter(user=request.user)
    }
    return render(request, 'collation/collations.html', context)
