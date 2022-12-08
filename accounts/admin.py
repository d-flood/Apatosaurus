from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin

from accounts.forms import CustomUserCreationForm, CustomUserChangeForm
from accounts import models

CustomUser = get_user_model()


class CustomUserAdmin(UserAdmin):
    add_form = CustomUserCreationForm
    form = CustomUserChangeForm
    model = CustomUser
    list_display = [
        'email', 
        'username',
        'is_staff',
        'is_superuser',
    ]
    # fieldsets = (
    #     *UserAdmin.fieldsets,  # original form fieldsets, expanded
    #     (                      
    #         None,             # group heading of None means we'll have no heading  
    #         {
    #             'fields': (),
    #         },
    #     ),
    # )

admin.site.register(CustomUser, CustomUserAdmin)
admin.site.register((
    models.UserFeedback,
    models.BugReport,
    models.JobStatus,
))
