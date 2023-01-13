# TO DO

- Support more sophisticated TEI import and export formats as [Joey McCollum demonstrates](https://jjmccollum.github.io/teiphy/advanced.html#analysis-at-varying-levels-of-detail-using-reading-types).

## Priority
- make the other six open-cbgm modules call a cached db
- continue containerizing
    - App is containerized, but that necessitates updatig the handling of user files (see below).
- store user open-cbgm databases in S3 and cache them on server
- finish user profile and implement `django-registration`
- set a limit for the number of completed background jobs that can exist
- set up litestream