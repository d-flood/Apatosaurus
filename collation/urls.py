from django.urls import path

from collation import views

urls = [
    path(
        "",
        views.main,
        name="collation",
    ),
    path(
        "new/",
        views.new_colation,
        name="new-collation",
    ),
    path(
        "edit-collation/<int:collation_pk>/",
        views.edit_collation,
        name="edit-collation",
    ),
    path(
        "download-tei-collation/<int:collation_pk>/",
        views.download_tei_collation,
        name="download-tei-collation",
    ),
    path(
        "analyze/<int:collation_pk>/",
        views.analyze_collation,
        name="analyze-collation",
    ),
    path(
        "filter-variants/<int:collation_pk>/",
        views.filter_variants,
        name="filter-variants",
    ),
    path(
        "sections/<int:collation_pk>/",
        views.sections,
        name="section-list",
    ),
    path(
        "new-section/<int:collation_pk>/",
        views.new_section,
        name="new-section",
    ),
    path(
        "upload-tei/<int:section_pk>/",
        views.upload_tei_collation,
        name="upload-tei",
    ),
    path(
        "download-tei-section/<int:section_pk>/",
        views.download_tei_section,
        name="download-tei-section",
    ),
    path(
        "edit-section/<int:section_pk>/",
        views.edit_section,
        name="edit-section",
    ),
    path(
        "new-ab/<int:section_pk>/",
        views.new_ab,
        name="new-ab",
    ),
    path(
        "list-abs/<int:section_pk>/",
        views.abs,
        name="list-abs",
    ),
    path(
        "edit-ab/<int:ab_pk>/",
        views.edit_ab,
        name="edit-ab",
    ),
    path(
        "ab-note/<int:ab_pk>/",
        views.ab_note,
        name="ab-note",
    ),
    path(
        "download-tei-ab/<int:ab_pk>/",
        views.download_tei_ab,
        name="download-tei-ab",
    ),
    path(
        "apparatus/<int:ab_pk>/",
        views.apparatus,
        name="apparatus",
    ),
    path(
        "refresh-basetext/<int:ab_pk>/basetext/",
        views.refresh_basetext,
        name="refresh-basetext",
    ),
    path(
        "show-deleted-apps/<int:ab_pk>/",
        views.show_deleted_apps,
        name="show-deleted-apps",
    ),
    path(
        "cancel-edit-app/<int:ab_pk>/",
        views.cancel_edit_app,
        name="cancel-edit-app",
    ),
    path(
        "edit-app/<int:ab_pk>/<int:app_pk>/",
        views.edit_app,
        name="edit-app",
    ),
    path(
        "edit-app/<int:ab_pk>/<int:app_pk>/<str:permanently_delete>/",
        views.edit_app,
        name="edit-app",
    ),
    path(
        "restore-app/<int:app_pk>/",
        views.restore_app,
        name="restore-app",
    ),
    path(
        "apps/combine-apps/",
        views.combine_apps,
        name="combine-apps",
    ),
    path(
        "readings/<int:app_pk>/",
        views.rdgs,
        name="rdgs",
    ),
    path(
        "new-reading/<int:app_pk>/",
        views.new_rdg,
        name="new-rdg",
    ),
    path(
        "edit-reading/<int:rdg_pk>/",
        views.edit_rdg,
        name="edit-rdg",
    ),
    path(
        "cancel-new-reading/<int:app_pk>/",
        views.cancel_new_rdg,
        name="cancel-new-rdg",
    ),
    path(
        "reading-note/<int:rdg_pk>/",
        views.reading_note,
        name="reading-note",
    ),
    path(
        "edit-arc/<int:app_pk>/<int:delete>/",
        views.edit_arc,
        name="edit-arc",
    ),
    path(
        "reading-history/<int:rdg_pk>/",
        views.rdg_history,
        name="rdg-history",
    ),
    path(
        "restore-reading/<int:rdg_pk>/<int:history_pk>/",
        views.restore_rdg,
        name="restore-rdg",
    ),
]
