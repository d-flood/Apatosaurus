# Future Work

- **Collation punctuation:** define and test how punctuation participates in tokenization, regularization,
  alignment, and the `ignorePunctuation` setting.
- **Collation undo and redo:** add reversible editing for post-alignment collation workflows without creating
  another persisted representation of the canonical collation document.
- **Image caching:** investigate explicit offline caching for transcription images, including direct image URLs
  and IIIF tiles, with visible storage use and eviction controls.
