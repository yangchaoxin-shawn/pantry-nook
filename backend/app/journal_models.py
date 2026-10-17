"""手记请求与响应契约。"""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class JournalInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entry_date: date
    caption: str = Field(default='', max_length=2000)


class EntryCreate(JournalInput):
    upload_ids: list[UUID] = Field(min_length=1, max_length=9)
    client_request_id: UUID
    cover_upload_id: UUID | None = None


class EntryUpdate(JournalInput):
    expected_updated_at: datetime
    upload_ids: list[UUID] | None = Field(default=None, min_length=1, max_length=9)
    cover_upload_id: UUID | None = None
    client_request_id: UUID | None = None

    @model_validator(mode='after')
    def complete_photo_edit(self):
        if self.upload_ids is not None or self.cover_upload_id is not None:
            if self.upload_ids is None or self.cover_upload_id is None or self.client_request_id is None:
                raise ValueError('修改照片需要提交完整照片列表、封面与请求标识')
        return self


class UploadedAsset(BaseModel):
    id: UUID
    kind: Literal['image']
    original_name: str
    original_size: int
    sha256: str
    width: int
    height: int
    preview_width: int
    preview_height: int
    preview_url: str
    thumbnail_url: str
    original_url: str
    taken_on: date | None = Field(default=None, description='照片自带的拍摄日期；没有记录时为空')


class JournalPhoto(BaseModel):
    id: UUID
    image: UploadedAsset


class JournalEntry(BaseModel):
    id: int
    cover_upload_id: UUID
    entry_date: date
    caption: str
    created_at: datetime
    updated_at: datetime
    ordinal: int = Field(description='第几顿：全部手记按日期、再按记录先后排，最早一顿为 1；删除或补记会让之后的编号变化')
    photos: list[JournalPhoto]


class UploadResponse(BaseModel):
    data: UploadedAsset


class EntryResponse(BaseModel):
    data: JournalEntry


class JournalMeta(BaseModel):
    total: int
    limit: int
    offset: int
    month_totals: dict[str, int] = Field(default_factory=dict, description='本页出现的月份（YYYY-MM）各有多少顿；按月筛选时为空')


class EntryListResponse(BaseModel):
    data: list[JournalEntry]
    meta: JournalMeta


class JournalDeleteResponse(BaseModel):
    data: dict[str, bool]
