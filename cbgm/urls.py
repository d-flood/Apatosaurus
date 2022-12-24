from django.urls import path


from cbgm import views

urls = [
    path('', views.main, name='open-cbgm'),
    path('send-cbgm-db-form/<int:corpus_pk>/<int:corpus_type>/', views.send_section_form, name='send-cbgm-db'),
    # path('import-tei/section/<int:section_pk>/', views.send_section_for_import, name='import-tei-section'),
    path('edit/db/<int:db_pk>/', views.edit_db, name='edit-db'),
    path('refresh-dbs/', views.refresh_dbs, name='refresh-dbs'),
    path('set-active-db/<int:db_pk>/', views.set_active_db, name='set-active-db'),
    path('compare-witnesses/<int:db_pk>/', views.compare_witnesses, name='compare-witnesses'),
    path('find-relatives/<int:db_pk>/', views.find_relatives, name='find-relatives'),
    path('get-rdgs-for-app/<int:db_pk>/<str:variation_unit>/', views.get_rdgs_for_app, name='get-rdgs-for-app'),
    path('optimize-substemmata/<int:db_pk>/', views.optimize_substemma, name='optimize-substemmata'),
    path('print-local-stemma/<int:db_pk>/<str:variation_unit>/', views.local_stemma, name='local-stemma'),
    path('print-textual-flow/<int:db_pk>/', views.textual_flow, name='textual-flow'),
    path('print-global-stemma/<int:db_pk>/', views.global_stemma, name='global-stemma'),
]
