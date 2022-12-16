from django.urls import path


from cbgm import views

urls = [
    path('', views.main, name='open-cbgm'),
    path('send-section-form/<int:section_pk>/', views.send_section_form, name='send-section-form'),
    # path('import-tei/section/<int:section_pk>/', views.send_section_for_import, name='import-tei-section'),
    path('edit/db/<int:db_pk>/', views.edit_db, name='edit-db'),
    path('refresh-dbs/', views.refresh_dbs, name='refresh-dbs'),
    path('set-active-db/<int:db_pk>/', views.set_active_db, name='set-active-db'),
    path('compare-witnesses/<int:db_pk>/', views.compare_witnesses, name='compare-witnesses'),
]
