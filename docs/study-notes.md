# Private study notes

Use **Save question for study** within an answered question in an ended report,
then open **Study** in navigation. Each account has one saved reference per
interview/question pair. Repeated saves keep the existing note and timestamp.
Only answered questions present in the report can be saved.

The study list uses 20 items per page (API maximum 100), ordered by saved time
descending and ID for ties. Notes are plain text, support Unicode and are limited
to 4,000 characters. Failed saves retain edits for retry. Removing a saved
question does not change its source interview; deleting the source interview
removes the saved reference and note. Raw media and hidden judge data are never
copied. Migration 0005 adds the owner-scoped study records.
