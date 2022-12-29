from django.urls import path

from published import views

urls = [
    path('', views.main, name='published'),
    path('browse-collation/<int:collation_pk>/', views.browse_collation, name='browse-collation'),
    path('browse-collation/<int:collation_pk>/<int:user_pk>/', views.browse_collation, name='browse-collation'),
    path('browse-section/<int:section_pk>/', views.browse_section, name='browse-section'),
    path('browse-section/<int:section_pk>/<int:user_pk>/', views.browse_section, name='browse-section'),
    path('browse-editor/<int:user_pk>/', views.browse_editor, name='browse-editor'),
    path('apparatus/<int:ab_pk>/', views.apparatus, name='published-apparatus'),
    path('apparatus/<int:ab_pk>/<int:user_pk>/', views.apparatus, name='published-apparatus'),
    # path('browse-section-editor/<int:section_pk>/<int:user_pk>/', views.browse_section_editor, name='browse-section-editor'),
    # path('browse-collation-editor/<int:collation_pk>/<int:user_pk>/', views.browse_collation_editor, name='browse-collation-editor'),
]