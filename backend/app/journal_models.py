"""手记请求与响应契约。"""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class JournalInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entry_date: date
    caption: str = Field(default='', max_length=2000)


class EntryCreate(JournalInput):
    upload_ids: list[UUID] = Field(min_length=1, max_length=18)
    client_request_id: UUID


class EntryUpdate(JournalInput):
    expected_updated_at: datetime


class UploadedAsset(BaseModel):
    id: UUID
    kind: Literal['image', 'video']
    live_kind: Literal['still', 'apple_photo', 'apple_video', 'motion_photo']
    pair_identifier: str | None
    original_name: str
    original_size: int
    sha256: str
    width: int
    height: int
    preview_width: int
    preview_height: int
    preview_url: str | None
    thumbnail_url: str | None
    original_url: str
    video_url: str | None


class JournalPhoto(BaseModel):
    id: UUID
    image: UploadedAsset
    motion: UploadedAsset | None
    live_status: Literal['still', 'live', 'missing_video']
    video_url: str | None


class JournalEntry(BaseModel):
    id: int
    entry_date: date
    caption: str
    created_at: datetime
    updated_at: datetime
    photos: list[JournalPhoto]


class UploadResponse(BaseModel):
    data: UploadedAsset


class EntryResponse(BaseModel):
    data: JournalEntry


class JournalMeta(BaseModel):
    total: int
    limit: int
    offset: int


class EntryListResponse(BaseModel):
    data: list[JournalEntry]
    meta: JournalMeta


class JournalDeleteResponse(BaseModel):
    data: dict[str, bool]
