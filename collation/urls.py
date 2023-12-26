from django.urls import path

from collation import views

urls = [
    path("", views.main, name="collation"),
    path("new/", views.new_colation, name="new-collation"),
    path("<int:collation_pk>/edit/", views.edit_collation, name="edit-collation"),
    path(
        "<int:collation_pk>/download-tei",
        views.download_tei_collation,
        name="download-tei-collation",
    ),
    path(
        "<slug:collation_slug>/analyze/",
        views.analyze_collation,
        name="analyze-collation",
    ),
    path(
        "<slug:collation_slug>/filter-variants/",
        views.filter_variants,
        name="filter-variants",
    ),
    path("<slug:collation_slug>/sections/", views.sections, name="section-list"),
    path("<int:collation_pk>/new-section/", views.new_section, name="new-section"),
    path(
        "collation_slug/<int:section_id>/upload-tei/",
        views.upload_tei_collation,
        name="upload-tei",
    ),
    path(
        "collation_slug/<int:section_pk>/download-tei",
        views.download_tei_section,
        name="download-tei-section",
    ),
    path(
        "collation_slug/<int:section_id>/edit/", views.edit_section, name="edit-section"
    ),  # TODO: use actual slugs
    path("collation_slug/<int:section_id>/verses/", views.new_ab, name="new-ab"),
    path(
        "<slug:collation_slug>/<str:section_slugname>/verses/",
        views.abs,
        name="ab-list",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/edit/", views.edit_ab, name="edit-ab"
    ),
    path("collation_slug/section_slug/<int:ab_pk>note/", views.ab_note, name="ab-note"),
    path(
        "collation_slug/section_slug/<int:ab_pk>/download-tei/",
        views.download_tei_ab,
        name="download-tei-ab",
    ),
    path(
        "<slug:collation_slug>/<str:section_slugname>/<str:ab_slugname>/apparatus/",
        views.apparatus,
        name="apparatus",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/basetext/",
        views.refresh_basetext,
        name="refresh-basetext",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/deleted-apps/",
        views.show_deleted_apps,
        name="show-deleted-apps",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/cancel-edit-app/",
        views.cancel_edit_app,
        name="cancel-edit-app",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/<int:app_pk>/edit/",
        views.edit_app,
        name="edit-app",
    ),
    path(
        "collation_slug/section_slug/<int:ab_pk>/<int:app_pk>/<str:permanently_delete>/",
        views.edit_app,
        name="edit-app",
    ),
    path("apps/restore-app/<int:app_pk>/", views.restore_app, name="restore-app"),
    path("apps/combine-apps/", views.combine_apps, name="combine-apps"),
    path("readings/variation-unit/<int:app_pk>/", views.rdgs, name="rdgs"),
    path(
        "collation_slug/section_slug/ab_slug/<int:app_pk>/rdgs/new/",
        views.new_rdg,
        name="new-rdg",
    ),
    path(
        "collation_slug/section_slug/ab_slug/app_slug/<int:rdg_pk>/edit/",
        views.edit_rdg,
        name="edit-rdg",
    ),
    path(
        "collation_slug/section_slug/ab_slug/<int:app_pk>/rdg/cancel/",
        views.cancel_new_rdg,
        name="cancel-new-rdg",
    ),
    path(
        "collation_slug/section_slug/ab_slug/app_slug/<int:rdg_pk>/note/",
        views.reading_note,
        name="reading-note",
    ),
    path(
        "collation_slug/section_slug/ab_slug/<int:app_pk>/<int:delete>/edit-arc/",
        views.edit_arc,
        name="edit-arc",
    ),
    path(
        "collation_slug/section_slug/ab_slug/app_slug/<int:rdg_pk>/history/",
        views.rdg_history,
        name="rdg-history",
    ),
    path(
        "collation_slug/section_slug/ab_slug/app_slug/<int:rdg_pk>/<int:history_pk>/restore/",
        views.restore_rdg,
        name="restore-rdg",
    ),
]
