from django.urls import path, include


from content import views


urls = [
    path('about/', views.index, name='about'),
    path('about/<slug:slug>/', views.index, name='about'),
    path('<slug:slug>/', views.index, name='presentation'),
]