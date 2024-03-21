from django.urls import include, path

from content import views

urls = [
    path("about/", views.index, name="about"),
    path("about/<slug:slug>/", views.index, name="about"),
    path("announcements/", views.announcements, name="announcements"),
    path("<slug:slug>/", views.index, name="presentation"),
]
