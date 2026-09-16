-- 封面独立于照片顺序；历史手记保持首张图片作为封面。
ALTER TABLE journal_entries ADD COLUMN cover_upload_id UUID REFERENCES journal_uploads(id);
UPDATE journal_entries e SET cover_upload_id = (
    SELECT u.id FROM journal_uploads u
    WHERE u.entry_id=e.id AND u.details->>'kind'='image'
    ORDER BY u.position,u.id LIMIT 1
);
ALTER TABLE journal_entries ALTER COLUMN cover_upload_id SET NOT NULL;

-- 编辑请求单独记录，不覆盖创建时的幂等标识。
CREATE TABLE journal_entry_edits (
    client_request_id UUID PRIMARY KEY,
    entry_id BIGINT NOT NULL REFERENCES journal_entries(id),
    request_sha256 TEXT NOT NULL,
    result_updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX journal_entry_edits_entry_idx ON journal_entry_edits(entry_id);
