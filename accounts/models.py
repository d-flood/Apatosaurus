from django.contrib.auth.models import AbstractUser
from django.db import models


class CustomUser(AbstractUser):
    pass
    

class UserFeedback(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='feedback')
    message = models.TextField(verbose_name='New Question or Comment Concerning this Website')
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    closed = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return f'{self.user} __ {self.created.date()} | {"✓" if self.closed else "✖"}'


class BugReport(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='bug_reports')
    steps_to_reproduce = models.TextField(verbose_name='Steps to Reproduce', help_text='Please explain the steps you took that led to the bug.')
    expected_result = models.TextField(verbose_name='Expected Result', help_text='What did you expect to happen after doing the above?')
    actual_result = models.TextField(verbose_name='Actual Result', help_text='What actually happened after doing the above?')
    error_text = models.TextField(verbose_name='Error Text', help_text='If there was an error message, please copy and paste it here.', blank=True)
    comments = models.TextField(verbose_name='Comments', help_text='Any additional comments you would like to make?', blank=True)
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)
    closed = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return f'{self.user} __ {self.created.date()} | {"✓" if self.closed else "✖"}'
