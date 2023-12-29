from django.urls import path

from transcriptions import views

urls = [
    path(
        "<int:witness_pk>/",
        views.main,
        name="transcriptions",
    ),
    path(
        "new/<int:witness_pk>/",
        views.new_transcription,
        name="new-transcription",
    ),
    path(
        "edit/<int:transcription_pk>/",
        views.edit_transcription,
        name="edit-transcription",
    ),
    path(
        "upload-tei/<int:witness_pk>/",
        views.upload_tei_transcription,
        name="import-tei-transcription",
    ),
    path(
        "delete/<int:witness_pk>/",
        views.delete_all_transcriptions_for_witness,
        name="delete-transcriptions",
    ),
]
