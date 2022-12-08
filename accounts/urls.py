# from django.contrib.auth import views as auth_views
from django.urls import path, include

# from django_registration.backends.activation.views import RegistrationView

from accounts import views, forms

urls = [
    path('', include('django.contrib.auth.urls')),
    path('profile/', views.profile, name='user-profile'),
    path('get-user-joblist/', views.get_user_joblist, name='user-job-list'),
    path('delete-job-status/<int:job_pk>/', views.delete_job_status, name='delete-job-status'),
]