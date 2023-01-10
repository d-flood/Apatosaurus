from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm, UserChangeForm
from django_registration.forms import RegistrationForm

from accounts import models


class CustomUserCreationForm(UserCreationForm):
    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "display_name",
        )


class CustomUserChangeForm(UserChangeForm):
    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "display_name",
        )


class CustomUserRegistrationForm(RegistrationForm):
    # TODO: add a captha field
    class Meta(RegistrationForm.Meta):
        model = get_user_model()
        fields = (
            "email",
            "username",
            "registration_purpose",
        )


class UserFeedbackForm(forms.ModelForm):
    class Meta:
        model = models.UserFeedback
        fields = (
            'message',
        )


class BugReportForm(forms.ModelForm):
    class Meta:
        model = models.BugReport
        fields = (
            'steps_to_reproduce',
            'expected_result',
            'actual_result',
            'error_text',
            'comments',
        )
