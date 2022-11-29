from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/collation/', views.new_colation, name='new-collation'),
    path('new/section/<int:collation_id>/', views.new_section, name='new-section'),
    path('new/ab/<int:section_id>/', views.new_ab, name='new-ab'),
    path('new/rdg/<int:app_pk>/', views.new_rdg, name='new-rdg'),
    path('new/rdg-cancel/<int:app_pk>/', views.cancel_new_rdg, name='cancel-new-rdg'),
    path('sections/<int:collation_id>/', views.sections, name='section-list'),
    path('collation-list/', views.collations, name='collation-list'),
    path('ab-list/<int:section_id>/', views.abs, name='ab-list'),
    path('apparatus/<int:ab_pk>/', views.apparatus, name='apparatus'),
    path('edit-app/<int:ab_pk>/<int:app_pk>/', views.edit_app, name='edit-app'),
    path('cancel-edit-app/<int:ab_pk>/', views.cancel_edit_app, name='cancel-edit-app'),
    path('rdgs/<int:app_pk>/', views.rdgs, name='rdgs'),
    path('refresh-basetext/<int:ab_pk>/', views.refresh_basetext, name='refresh-basetext'),
]