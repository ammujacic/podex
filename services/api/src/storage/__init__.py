"""Storage services for file management."""

from src.storage.gcs import S3Storage, get_storage

# Proper GCS naming
GCSStorage = S3Storage

__all__ = ["GCSStorage", "S3Storage", "get_storage"]
