"""CONFIG URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from os import environ

from django.contrib import admin
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.urls import path, include

from CONFIG import settings
from published.urls import urls as published_urls
from accounts.urls import urls as accounts_urls
from collation.urls import urls as collation_urls
from witnesses.urls import urls as witnesses_urls
from cbgm.urls import urls as cbgm_urls


def home(request: HttpRequest) -> HttpResponse:
    context = {
        'page': {
            'title': 'Home - Apatosaurus', 
            'description': 'A Web Application for visualizing, editing, analyzing, and publishing digital collations of ancient texts.',
            'active': 'home',
        },
    }
    return render(request, 'home.html', context)


urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path('', home, name='home'),
    path('published/', include(published_urls)),
    path('accounts/', include(accounts_urls)),
    path('collation/', include(collation_urls)),
    path('witnesses/', include(witnesses_urls)),
    path('cbgm/', include(cbgm_urls)),
]
