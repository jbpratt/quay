import hashlib
import json
import os
import tarfile
from contextlib import closing
from io import BytesIO

import pytest

from data.database import (
    ImageStorage,
    ImageStorageLocation,
    ImageStoragePlacement,
    UploadedBlob,
)
from data.model import blob as blob_model
from data.model import storage as storage_model
from data.model.oci import retriever as retriever_module
from data.model.oci.manifest import get_or_create_manifest
from data.model.oci.retriever import RepositoryContentRetriever
from data.registry_model.blobuploader import (
    BlobDigestMismatchException,
    BlobTooLargeException,
    BlobUploadException,
    BlobUploadSettings,
    _BlobUploadManager,
    retrieve_blob_upload_manager,
    upload_blob,
)
from data.registry_model.registry_oci_model import OCIModel
from digest import digest_tools
from image.docker.schema2.manifest import DockerSchema2ManifestBuilder
from storage.distributedstorage import DistributedStorage
from storage.fakestorage import FakeStorage
from test.fixtures import *
from util.locking import LockNotAcquiredException


@pytest.fixture()
def registry_model(initialized_db):
    return OCIModel()


@pytest.mark.parametrize(
    "chunk_count",
    [
        0,
        1,
        2,
        10,
    ],
)
@pytest.mark.parametrize(
    "subchunk",
    [
        True,
        False,
    ],
)
def test_basic_upload_blob(chunk_count, subchunk, registry_model):
    repository_ref = registry_model.lookup_repository("devtable", "complex")
    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("2M", 3600)
    app_config = {"TESTING": True}

    data = b""
    with upload_blob(repository_ref, storage, settings) as manager:
        assert manager
        assert manager.blob_upload_id

        for index in range(0, chunk_count):
            chunk_data = os.urandom(100)
            data += chunk_data

            if subchunk:
                manager.upload_chunk(app_config, BytesIO(chunk_data))
                manager.upload_chunk(app_config, BytesIO(chunk_data), (index * 100) + 50)
            else:
                manager.upload_chunk(app_config, BytesIO(chunk_data))

        blob = manager.commit_to_blob(app_config)

    # Check the blob.
    assert blob.compressed_size == len(data)
    assert blob.digest == "sha256:" + hashlib.sha256(data).hexdigest()

    # Ensure the blob exists in storage and has the expected data.
    assert storage.get_content(["local_us"], blob.storage_path) == data


def test_cancel_upload(registry_model):
    repository_ref = registry_model.lookup_repository("devtable", "complex")
    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("2M", 3600)
    app_config = {"TESTING": True}

    blob_upload_id = None
    with upload_blob(repository_ref, storage, settings) as manager:
        blob_upload_id = manager.blob_upload_id
        assert registry_model.lookup_blob_upload(repository_ref, blob_upload_id) is not None

        manager.upload_chunk(app_config, BytesIO(b"hello world"))

    # Since the blob was not comitted, the upload should be deleted.
    assert blob_upload_id
    assert registry_model.lookup_blob_upload(repository_ref, blob_upload_id) is None


def test_too_large(registry_model):
    repository_ref = registry_model.lookup_repository("devtable", "complex")
    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("1K", 3600)
    app_config = {"TESTING": True}

    with upload_blob(repository_ref, storage, settings) as manager:
        with pytest.raises(BlobTooLargeException):
            manager.upload_chunk(app_config, BytesIO(os.urandom(1024 * 1024 * 2)))


def test_extra_blob_stream_handlers(registry_model):
    handler1_result = []
    handler2_result = []

    def handler1(bytes_data):
        handler1_result.append(bytes_data)

    def handler2(bytes_data):
        handler2_result.append(bytes_data)

    repository_ref = registry_model.lookup_repository("devtable", "complex")
    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("1K", 3600)
    app_config = {"TESTING": True}

    with upload_blob(
        repository_ref, storage, settings, extra_blob_stream_handlers=[handler1, handler2]
    ) as manager:
        manager.upload_chunk(app_config, BytesIO(b"hello "))
        manager.upload_chunk(app_config, BytesIO(b"world"))

    assert b"".join(handler1_result) == b"hello world"
    assert b"".join(handler2_result) == b"hello world"


def valid_tar_gz(contents):
    assert isinstance(contents, bytes)
    with closing(BytesIO()) as layer_data:
        with closing(tarfile.open(fileobj=layer_data, mode="w|gz")) as tar_file:
            tar_file_info = tarfile.TarInfo(name="somefile")
            tar_file_info.type = tarfile.REGTYPE
            tar_file_info.size = len(contents)
            tar_file_info.mtime = 1
            tar_file.addfile(tar_file_info, BytesIO(contents))

        layer_bytes = layer_data.getvalue()
    return layer_bytes


def test_uncompressed_size(registry_model):
    repository_ref = registry_model.lookup_repository("devtable", "complex")
    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("1K", 3600)
    app_config = {"TESTING": True}

    with upload_blob(repository_ref, storage, settings) as manager:
        manager.upload_chunk(app_config, BytesIO(valid_tar_gz(b"hello world")))

        blob = manager.commit_to_blob(app_config)

    assert blob.compressed_size is not None
    assert blob.uncompressed_size is not None


class _FakeGlobalLock:
    """
    Single-process stand-in for util.locking.GlobalLock: same mutual-exclusion
    semantics by lock name (a second acquisition of a held name raises
    LockNotAcquiredException, matching a contended Redis lock), but without
    threads or Redis, so the finalize/GC interleaving can be driven
    deterministically from a single call stack.
    """

    _held = set()

    def __init__(self, name, lock_ttl=600, auto_renewal=False):
        self._name = name

    def __enter__(self):
        if self._name in self._held:
            raise LockNotAcquiredException()
        self._held.add(self._name)
        return self

    def __exit__(self, exc_type, exc_value, exc_traceback):
        self._held.discard(self._name)


def test_finalize_gc_race_leaves_db_positive_cas_negative(registry_model, monkeypatch):
    """
    Regression test for the blob finalize/GC lock gap.

    _finalize_blob_storage checks storage existence and, if the digest is
    already there, dedupes by cancelling the new upload's own chunks instead
    of writing them -- trusting the existing object to remain in place. That
    check currently happens outside the BLOB_DELETE_<digest> lock that guards
    the later DB/temp-link commit, so GC can remove the CAS object for the
    same digest in the gap: the new upload still commits a fresh DB row, and
    the blob ends up DB-positive (UploadedBlob + placement) but CAS-negative
    (no object). A correctly synchronized commit must not allow this: once
    committed, the blob must be genuinely retrievable.
    """
    monkeypatch.setattr(retriever_module, "RETRY_DELAY", 0)
    monkeypatch.setattr(storage_model, "GlobalLock", _FakeGlobalLock)
    _FakeGlobalLock._held.clear()

    storage = DistributedStorage({"local_us": FakeStorage(None)}, ["local_us"])
    settings = BlobUploadSettings("2M", 3600)
    app_config = {"TESTING": True}

    # A minimal, valid schema-2 config blob (must be UTF-8 JSON: it is parsed as
    # DockerSchema2Config once retrieved).
    data = json.dumps({"rootfs": {"type": "layers", "diff_ids": []}, "history": []}).encode("utf-8")
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    content_path = digest_tools.content_path(digest)

    # Seed an orphan blob: a CAS object plus ImageStorage/placement with no
    # UploadedBlob or ManifestBlob referencing it, as if the repository/tag
    # that once referenced it has already expired and GC is about to reclaim
    # it.
    location = ImageStorageLocation.get(name="local_us")
    orphan_storage = ImageStorage.create(content_checksum=digest, image_size=len(data))
    ImageStoragePlacement.create(storage=orphan_storage, location=location)
    storage.put_content(["local_us"], content_path, data)

    real_finalize = _BlobUploadManager._finalize_blob_storage

    def finalize_then_run_gc(self, app_config):
        # The real finalize logic: sees the orphan's CAS object and dedupes,
        # cancelling this upload's own chunks instead of writing them.
        already_existed = real_finalize(self, app_config)
        assert already_existed is True

        # GC runs concurrently right after: it already dropped the orphan's
        # DB rows as unreferenced, and now removes the CAS object under the
        # same per-digest lock the commit path is supposed to hold too. If
        # that lock is unavailable (held by the commit path), GC backs off
        # and leaves the object alone, exactly like the real GC's
        # LockNotAcquiredException handling in data/model/storage.py.
        try:
            with storage_model.GlobalLock(f"BLOB_DELETE_{digest}", lock_ttl=120):
                ImageStoragePlacement.delete().where(
                    ImageStoragePlacement.storage == orphan_storage
                ).execute()
                orphan_storage.delete_instance()
                storage.remove(["local_us"], content_path)
        except LockNotAcquiredException:
            pass

        return already_existed

    monkeypatch.setattr(_BlobUploadManager, "_finalize_blob_storage", finalize_then_run_gc)

    repository_ref = registry_model.lookup_repository("devtable", "simple")
    with upload_blob(repository_ref, storage, settings) as manager:
        manager.upload_chunk(app_config, BytesIO(data))
        blob = manager.commit_to_blob(app_config)

    assert blob is not None
    fresh_storage = ImageStorage.get(content_checksum=digest)
    assert (
        ImageStoragePlacement.select()
        .where(ImageStoragePlacement.storage == fresh_storage)
        .exists()
    )
    assert (
        UploadedBlob.select()
        .where(UploadedBlob.repository == repository_ref.id, UploadedBlob.blob == fresh_storage)
        .exists()
    )

    # The commit must not leave a DB-positive, CAS-negative blob: the object
    # must still be retrievable.
    assert storage.get_content(["local_us"], content_path) == data

    # A schema-2 child manifest referencing the blob as its config must be
    # createable through the real retriever. Populate a second, unrelated
    # layer blob normally so the only interesting blob in this manifest is
    # the racy config digest.
    random_data = b"unrelated layer content"
    random_digest = str(digest_tools.sha256_digest(random_data))
    layer_storage = blob_model.store_blob_record_and_temp_link_in_repo(
        repository_ref.id, random_digest, location.id, len(random_data), 3600
    )
    storage.put_content(["local_us"], storage_model.get_layer_path(layer_storage), random_data)

    builder = DockerSchema2ManifestBuilder()
    builder.set_config_digest(digest, len(data))
    builder.add_layer(random_digest, len(random_data))
    manifest = builder.build()

    retriever = RepositoryContentRetriever(repository_ref.id, storage)
    get_or_create_manifest(
        repository_ref.id, manifest, storage, retriever=retriever, raise_on_error=True
    )
