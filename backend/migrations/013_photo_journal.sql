CREATE TABLE journal_entries (
    id BIGSERIAL PRIMARY KEY,
    client_request_id UUID NOT NULL UNIQUE,
    request_sha256 TEXT NOT NULL,
    entry_date DATE NOT NULL,
    caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX journal_entries_date_idx ON journal_entries(entry_date DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TABLE journal_uploads (
    id UUID PRIMARY KEY,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('processing','ready','failed','cancelled')),
    original_name TEXT NOT NULL,
    original_size BIGINT NOT NULL CHECK (original_size BETWEEN 1 AND 52428800),
    details JSONB,
    storage_path TEXT,
    entry_id BIGINT REFERENCES journal_entries(id),
    position SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX journal_uploads_entry_idx ON journal_uploads(entry_id, position);
CREATE INDEX journal_uploads_cleanup_idx ON journal_uploads(updated_at) WHERE entry_id IS NULL;
