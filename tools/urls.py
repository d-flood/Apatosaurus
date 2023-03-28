from django.urls import path

from tools import views


urls = [
    path('normalize-greek/', views.clean_greek_text, name='normalize-greek'),
]