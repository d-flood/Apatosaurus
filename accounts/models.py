import os
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class CustomUser(AbstractUser):
    display_name = models.CharField(
        max_length=50,
        blank=False,
        default="",
        help_text="The public name you would like to be displayed with your apparatus if you choose to publish it.",
    )
    registration_purpose = models.TextField(
        blank=False,
        default="",
        help_text="Briefly explain why you would like to use Apatosaurus.",
    )

    class Meta:
        ordering = ["-date_joined"]


class UserFeedback(models.Model):
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name="feedback"
    )
    message = models.TextField(
        verbose_name="New Question or Comment Concerning this Website"
    )
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f'{self.user} __ {self.created.date()} | {"✓" if self.closed else "✖"}'


class BugReport(models.Model):
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name="bug_reports"
    )
    steps_to_reproduce = models.TextField(
        verbose_name="Steps to Reproduce",
        help_text="Please explain the steps you took that led to the bug.",
    )
    expected_result = models.TextField(
        verbose_name="Expected Result",
        help_text="What did you expect to happen after doing the above?",
    )
    actual_result = models.TextField(
        verbose_name="Actual Result",
        help_text="What actually happened after doing the above?",
    )
    error_text = models.TextField(
        verbose_name="Error Text",
        help_text="If there was an error message, please copy and paste it here.",
        blank=True,
    )
    comments = models.TextField(
        verbose_name="Comments",
        help_text="Any additional comments you would like to make?",
        blank=True,
    )
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f'{self.user} __ {self.created.date()} | {"✓" if self.closed else "✖"}'


class JobStatus(models.Model):
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name="job_statuses"
    )
    name = models.CharField(max_length=50)
    completed = models.BooleanField(default=False)
    failed = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)
    in_progress = models.BooleanField(default=False)
    progress = models.IntegerField(default=0)
    message = models.CharField(max_length=100, default="")
    data = models.TextField(default="")
    textual_flow = models.BooleanField(default=False)

    def __str__(self):
        return f'{self.user} __ {self.name} | {"✓" if self.completed else "✖"}'

    class Meta:
        ordering = ["-created"]
        indexes = [models.Index(fields=["user"])]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # if self.user.job_statuses.count() > 20: # type: ignore
        #     self.user.job_statuses.last().delete() # type: ignore


def user_directory_path(instance, filename):
    name, ext = os.path.splitext(filename)
    unique_path = f"{name}_{uuid.uuid4()}"
    return f"user_files/{instance.user.username}/{unique_path}/{filename}"


class UserFile(models.Model):
    user = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name="user_files"
    )
    name = models.CharField(max_length=128)
    file = models.FileField(
        upload_to=user_directory_path, max_length=255, blank=False, null=False
    )
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]

    def __str__(self):
        return f"{self.user}: {self.name}"

    def delete(self, *args, **kwargs):
        self.file.delete()
        super().delete(*args, **kwargs)
