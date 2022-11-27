from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/', views.new_colation, name='new-collation'),
    path('sections/<int:collation_id>/', views.sections, name='section-list'),
    path('collation-list/', views.collations, name='collation-list'),
]