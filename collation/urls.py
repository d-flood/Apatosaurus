from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/', views.new_colation, name='new-collation'),
    path('edit/<int:collation_id>/', views.edit_collation, name='edit-collation'),
    path('<slug:collation_slug>/sections/', views.sections, name='section-list'),
    path('new-section/<int:collation_id>/', views.new_section, name='new-section'),
    path('edit-section/<int:section_id>/', views.edit_section, name='edit-section'),
    path('<slug:collation_slug>/<str:section_slugname>/', views.abs, name='ab-list'),
    path('new/ab/<int:section_id>/', views.new_ab, name='new-ab'),
    path('edit/ab/<int:ab_pk>/', views.edit_ab, name='edit-ab'),
    path('new/rdg/<int:app_pk>/', views.new_rdg, name='new-rdg'),
    path('edit/rdg/<int:rdg_pk>/', views.edit_rdg, name='edit-rdg'),
    path('new/rdg-cancel/<int:app_pk>/', views.cancel_new_rdg, name='cancel-new-rdg'),
    path('collation-list/', views.collations, name='collation-list'),
    path('apparatus/<int:ab_pk>/', views.apparatus, name='apparatus'),
    path('edit/app/<int:ab_pk>/<int:app_pk>/', views.edit_app, name='edit-app'),
    path('cancel-edit-app/<int:ab_pk>/', views.cancel_edit_app, name='cancel-edit-app'),
    path('rdgs/<int:app_pk>/', views.rdgs, name='rdgs'),
    path('refresh-basetext/<int:ab_pk>/', views.refresh_basetext, name='refresh-basetext'),
    path('arc/edit/<int:app_pk>/<int:delete>/', views.edit_arc, name='edit-arc'),
    path('upload-tei/<int:section_id>/', views.upload_tei_collation, name='upload-tei'),
    path('download-tei/ab/<int:ab_pk>/', views.download_tei_ab, name='download-tei-ab'),
    path('download-tei/section/<int:section_pk>/', views.download_tei_section, name='download-tei-section'),
    path('download-tei/collation/<int:collation_pk>/', views.download_tei_collation, name='download-tei-collation'),
    path('reading-notes/<int:rdg_pk>/', views.reading_note, name='reading-note'),
    path('rdg-history/<int:rdg_pk>/', views.rdg_history, name='rdg-history'),
    path('restore-rdg/<int:rdg_pk>/<int:history_pk>/', views.restore_rdg, name='restore-rdg'),
    path('ab/note/<int:ab_pk>/', views.ab_note, name='ab-note'),
]