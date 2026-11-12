"""Server-only commands, run inside the backend container: `python -m app.cli.<name>`.

They live inside the app package (not backend/scripts/, which .dockerignore
leaves out of the image) so they exist on the production server."""
