"""Private local storage lifecycle for explicitly retained interview recordings."""
import os
from pathlib import Path

RETENTION_DAYS = 30
MAX_MEDIA_BYTES = 100 * 1024 * 1024
ALLOWED_MEDIA_TYPES = frozenset({'audio/webm', 'video/webm', 'audio/mp4', 'video/mp4'})


def media_root():
    configured = os.getenv('INTERVIEW_MEDIA_DIR', '').strip()
    return Path(configured) if configured else Path(__file__).resolve().parents[1] / 'media-storage'


def ensure_media_root():
    root = media_root()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise OSError('media storage directory must not be a symbolic link')
    root.chmod(0o700)
    return root


def media_path(storage_key):
    if len(storage_key) != 36 or any(char not in '0123456789abcdef-' for char in storage_key):
        raise ValueError('Invalid media storage key')
    return ensure_media_root() / f'{storage_key}.media'


def remove_media_file(storage_key):
    try:
        media_path(storage_key).unlink(missing_ok=True)
    except OSError:
        # Keep expiry cleanup retryable if storage is temporarily unavailable.
        raise
