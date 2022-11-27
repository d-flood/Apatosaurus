# from django.contrib.auth import views as auth_views
from django.urls import path, include

# from django_registration.backends.activation.views import RegistrationView

from accounts import views, forms

urls = [
    path('', include('django.contrib.auth.urls')),
]