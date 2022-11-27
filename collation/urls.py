from django.urls import path

from collation import views

urls = [
    path('', views.main, name='collation'),
    path('new/', views.new_colation, name='new-collation'),
    path('chapters/<int:collation_id>/', views.chapters, name='chapter-list'),
    path('book-list/', views.books, name='book-list'),
]