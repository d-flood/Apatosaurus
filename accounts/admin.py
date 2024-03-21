from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin

from accounts import models
from accounts.forms import CustomUserChangeAdminForm, CustomUserCreationForm

CustomUser = get_user_model()


class CustomUserAdmin(UserAdmin):
    add_form = CustomUserCreationForm
    form = CustomUserChangeAdminForm
    model = CustomUser
    list_display = [
        "email",
        "username",
        "display_name",
        "is_staff",
        "is_superuser",
        "id",
    ]
    fieldsets = (
        *UserAdmin.fieldsets,  # original form fieldsets, expanded
        (
            None,  # group heading of None means we'll have no heading
            {
                "fields": ("display_name", "registration_purpose"),
            },
        ),
    )
    actions = ["set_has_unread_announcements"]

    def set_has_unread_announcements(self, request, queryset):
        queryset.update(has_unread_announcements=True)

    set_has_unread_announcements.short_description = (
        "Set has_unread_announcements to True for selected users"
    )


admin.site.register(CustomUser, CustomUserAdmin)
admin.site.register(
    (
        models.UserFeedback,
        models.BugReport,
        models.JobStatus,
    )
)
