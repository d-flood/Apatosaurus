from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/collation/', views.new_colation, name='new-collation'),
    path('new/section/<int:collation_id>/', views.new_section, name='new-section'),
    path('new/ab/<int:section_id>/', views.new_ab, name='new-ab'),
    path('sections/<int:collation_id>/', views.sections, name='section-list'),
    path('collation-list/', views.collations, name='collation-list'),
    path('ab-list/<int:section_id>/', views.abs, name='ab-list'),
]