from django.urls import path

from witnesses import views

urls = [
    path('', views.main, name='witnesses-main'),
    path('add/', views.add_new_witness, name='add-new-witness'),
    path('edit/witness/<int:witness_pk>/', views.edit_witness, name='edit-witness'),
    path('cancel/witness/', views.cancel_edit_witness, name='cancel-edit-witness'),
    path('refresh/user-witnesses/', views.refresh_user_witnesses, name='refresh-user-witnesses'),
]