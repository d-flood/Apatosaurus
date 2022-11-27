from django.shortcuts import render
from django.http import HttpRequest

# from render_block import render_block_to_string #? this threw a "SafeString" error

from collation import forms
from collation import models


def main(request):
    context = {
        'page': {'active': 'collation'}
    }
    return render(request, 'collation/main.html', context)


def new_colation(request: HttpRequest):
    if request.method == 'GET':
        form = forms.CollationForm()
        context = {
            'page': {'active': 'collation'},
            'new_collation_form': forms.CollationForm()
        }
        return render(request, 'collation/new_collation.html', context)
    elif request.method == 'POST':
        form = forms.CollationForm(request.POST)
        if form.is_valid():
            form.save(request.user)
        return render(request, 'collation/new_collation.html', {'page': {'active': 'collation'}})


def chapters(request: HttpRequest, collation_id: int):
    context = {
        'page': {'active': 'collation'},
        'chapters': models.Chapter.objects.filter(book__id=collation_id),
        'collation_title': models.Collation.objects.get(id=collation_id).name
    }
    return render(request, 'collation/chapters.html', context)


def books(request: HttpRequest):
    context = {
        'page': {'active': 'collation'},
        'books': models.Collation.objects.filter(user=request.user)
    }
    return render(request, 'collation/books.html', context)
