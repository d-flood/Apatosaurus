from django.urls import path

from published import views

urls = [
    path('', views.main, name='published'),
]