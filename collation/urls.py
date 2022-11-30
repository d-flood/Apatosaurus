from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/collation/', views.new_colation, name='new-collation'),
    path('edit/collation/<int:collation_id>/', views.edit_collation, name='edit-collation'),
    path('new/section/<int:collation_id>/', views.new_section, name='new-section'),
    path('edit/section/<int:section_id>/', views.edit_section, name='edit-section'),
    path('new/ab/<int:section_id>/', views.new_ab, name='new-ab'),
    path('edit/ab/<int:ab_pk>/', views.edit_ab, name='edit-ab'),
    path('new/rdg/<int:app_pk>/', views.new_rdg, name='new-rdg'),
    path('edit/rdg/<int:rdg_pk>/', views.edit_rdg, name='edit-rdg'),
    path('new/rdg-cancel/<int:app_pk>/', views.cancel_new_rdg, name='cancel-new-rdg'),
    path('sections/<int:collation_id>/', views.sections, name='section-list'),
    path('collation-list/', views.collations, name='collation-list'),
    path('ab-list/<int:section_id>/', views.abs, name='ab-list'),
    path('apparatus/<int:ab_pk>/', views.apparatus, name='apparatus'),
    path('edit/app/<int:ab_pk>/<int:app_pk>/', views.edit_app, name='edit-app'),
    path('cancel-edit-app/<int:ab_pk>/', views.cancel_edit_app, name='cancel-edit-app'),
    path('rdgs/<int:app_pk>/', views.rdgs, name='rdgs'),
    path('refresh-basetext/<int:ab_pk>/', views.refresh_basetext, name='refresh-basetext'),
]