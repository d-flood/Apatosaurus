from django.contrib import admin

from content import models


class ImageBlockInline(admin.TabularInline):
    model = models.ImageBlock
    exclude = ('html',)
    extra = 1

class AboutPageAdmin(admin.ModelAdmin):
    inlines = [ImageBlockInline]
    exclude = ('html',)


class ImageBlockAdmin(admin.ModelAdmin):
    exclude = ('html',)


admin.site.register(models.AboutPage, AboutPageAdmin)
