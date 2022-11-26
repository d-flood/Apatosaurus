from django.shortcuts import render


def main(request):
    context = {
        'page': {'active': 'published'}
    }
    return render(request, 'published/main.html', context)
