from django.contrib import admin

from collation import models

admin.site.register(
    (
        models.Collation,
        models.Section,
        models.Ab,
        models.App,
        models.Witness,
        models.Rdg,
        models.Arc,
        models.RdgHistory,
        models.CollationConfig,
    )
)


class CorpusComparisonAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "user", "created", "updated"]
    search_fields = ["name", "user__username"]
    list_filter = ["created", "updated", "user"]
    actions = ["generate_matrix", "generate_csv"]

    def generate_matrix(self, request, queryset):
        comparison: models.SectionComparison
        for comparison in queryset:
            comparison.generate_comparison()

    def generate_csv(self, request, queryset):
        comparison: models.SectionComparison
        for comparison in queryset:
            comparison.generate_csv()

    generate_matrix.short_description = (
        "Generate a comparison matrix for the selected comparisons"
    )
    generate_csv.short_description = (
        "Generate a CSV file from the existing matrix for the selected comparisons"
    )


admin.site.register(models.CollationComparison, CorpusComparisonAdmin)
admin.site.register(models.SectionComparison, CorpusComparisonAdmin)
