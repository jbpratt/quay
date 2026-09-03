package metastore_test

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/opencontainers/go-digest"

	"github.com/quay/quay/internal/dal/dbcore"
	"github.com/quay/quay/internal/dal/metastore"
	"github.com/quay/quay/internal/oci"
)

type tempTagRow struct {
	hidden        int64
	lifetimeEndMs sql.NullInt64
}

func setupStoreWithDB(t *testing.T) (*metastore.SQLiteStore, *sql.DB) {
	t.Helper()
	db, err := dbcore.Setup(t.Context(), filepath.Join(t.TempDir(), "quay.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store, err := metastore.NewSQLiteStore(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	return store, db
}

func tagsForManifest(t *testing.T, db *sql.DB, manifestID int64) []tempTagRow {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), `SELECT hidden, lifetime_end_ms FROM tag WHERE manifest_id = ?`, manifestID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []tempTagRow
	for rows.Next() {
		var r tempTagRow
		if err := rows.Scan(&r.hidden, &r.lifetimeEndMs); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPutManifest_UntaggedGetsTempTag(t *testing.T) {
	store, db := setupStoreWithDB(t)
	ctx := t.Context()
	repoID, err := store.EnsureRepository(ctx, oci.RepositoryName{Namespace: "library", Name: "nginx"})
	if err != nil {
		t.Fatal(err)
	}

	before := time.Now().UnixMilli()
	id, err := store.PutManifest(ctx, repoID, oci.ManifestRecord{
		Digest:    digest.FromString("by-digest"),
		MediaType: "application/vnd.oci.image.manifest.v1+json",
		Content:   []byte(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	tags := tagsForManifest(t, db, id)
	if len(tags) != 1 {
		t.Fatalf("expected exactly one temp tag, got %d", len(tags))
	}
	if tags[0].hidden != 1 || !tags[0].lifetimeEndMs.Valid {
		t.Fatalf("temp tag must be hidden and expiring, got %+v", tags[0])
	}
	minEnd := before + metastore.PushTempTagExpiration.Milliseconds()
	if tags[0].lifetimeEndMs.Int64 < minEnd {
		t.Fatalf("temp tag expires too early: %d < %d", tags[0].lifetimeEndMs.Int64, minEnd)
	}

	// Re-pushing the same manifest reuses the existing protection.
	if _, err := store.PutManifest(ctx, repoID, oci.ManifestRecord{
		Digest:    digest.FromString("by-digest"),
		MediaType: "application/vnd.oci.image.manifest.v1+json",
		Content:   []byte(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	renewed := tagsForManifest(t, db, id)
	if len(renewed) != 1 {
		t.Fatalf("expected temp tag to be renewed on re-push, got %d tags", len(renewed))
	}
	if renewed[0].lifetimeEndMs.Int64 < tags[0].lifetimeEndMs.Int64 {
		t.Fatalf("re-push must not shorten protection: %d < %d", renewed[0].lifetimeEndMs.Int64, tags[0].lifetimeEndMs.Int64)
	}

	// Visible tag listing does not expose the temp tag.
	names, err := store.ListTags(ctx, repoID)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 0 {
		t.Fatalf("temp tag must be hidden from ListTags, got %v", names)
	}
}

func TestPutManifest_TaggedOrReferrerSkipsTempTag(t *testing.T) {
	store, db := setupStoreWithDB(t)
	ctx := t.Context()
	repoID, err := store.EnsureRepository(ctx, oci.RepositoryName{Namespace: "library", Name: "nginx"})
	if err != nil {
		t.Fatal(err)
	}

	taggedID, err := store.PutManifest(ctx, repoID, oci.ManifestRecord{
		Digest:    digest.FromString("tagged"),
		MediaType: "application/vnd.oci.image.manifest.v1+json",
		Content:   []byte(`{}`),
		Tag:       "latest",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tag := range tagsForManifest(t, db, taggedID) {
		if tag.hidden == 1 {
			t.Fatalf("tagged push must not create a temp tag, got %+v", tag)
		}
	}

	referrerID, err := store.PutManifest(ctx, repoID, oci.ManifestRecord{
		Digest:       digest.FromString("referrer"),
		MediaType:    "application/vnd.oci.image.manifest.v1+json",
		Content:      []byte(`{}`),
		Subject:      digest.FromString("tagged"),
		ArtifactType: "application/vnd.dev.cosign.simplesigning.v1+json",
	})
	if err != nil {
		t.Fatal(err)
	}
	tags := tagsForManifest(t, db, referrerID)
	if len(tags) != 1 || tags[0].lifetimeEndMs.Valid {
		t.Fatalf("referrer keeps its single non-expiring hidden tag, got %+v", tags)
	}
}

func TestPutManifest_IndexWithMissingChildRejected(t *testing.T) {
	store, db := setupStoreWithDB(t)
	ctx := t.Context()
	repoID, err := store.EnsureRepository(ctx, oci.RepositoryName{Namespace: "library", Name: "nginx"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.PutManifest(ctx, repoID, oci.ManifestRecord{
		Digest:       digest.FromString("index"),
		MediaType:    "application/vnd.oci.image.index.v1+json",
		Content:      []byte(`{"manifests":[]}`),
		ChildDigests: []digest.Digest{digest.FromString("never-pushed")},
		Tag:          "latest",
	})
	if !errors.Is(err, oci.ErrNotExist) {
		t.Fatalf("expected oci.ErrNotExist for missing child, got %v", err)
	}

	// The whole write rolls back: no index row, no placeholder child, no tag.
	var manifests, tags int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM manifest`).Scan(&manifests); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tag`).Scan(&tags); err != nil {
		t.Fatal(err)
	}
	if manifests != 0 || tags != 0 {
		t.Fatalf("expected rollback, got %d manifests and %d tags", manifests, tags)
	}
}
