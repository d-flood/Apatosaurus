# TO DO

- Support more sophisticated TEI import and export formats as [Joey McCollum demonstrates](https://jjmccollum.github.io/teiphy/advanced.html#analysis-at-varying-levels-of-detail-using-reading-types).

## Priority

- Running on AWS Fargate is too expensive for now. Begin switching over to serverless functions _at least_ for task queue.
    - Lambda's can invoke other lambda's with boto3. It is possible to have an asynchronous/event such that a response is not expected. That should allow the main Django app to invoke a function and then return a response to the user. This is basically the same workflow as a task queue.
