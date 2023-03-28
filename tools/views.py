from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_http_methods, require_safe

from render_block import render_block_to_string

from collation import models as cmodels
from accounts.models import CustomUser
from collation.py import helpers as chelpers



def clean_greek_text(request: HttpRequest) -> HttpResponse:
    return render(request, 'tools/clean_greek_text.html', {})
