from django.contrib import admin

from content import models


class ImageBlockInline(admin.TabularInline):
    model = models.ImageBlock
    exclude = ("html",)
    extra = 1


@admin.register(models.AboutPage)
class AboutPageAdmin(admin.ModelAdmin):
    inlines = [ImageBlockInline]
    exclude = ("html",)


class ImageBlockAdmin(admin.ModelAdmin):
    exclude = ("html",)


@admin.register(models.Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    exclude = ("html",)
