"""Günlük yerel saatlerden bir sonraki UTC tetikleme anını hesaplar."""

import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


class RefreshSchedule(BaseModel):
    enabled: bool = False
    timezone: str = "Europe/Istanbul"
    times: list[str] = Field(default_factory=list, max_length=1440)
    notify_success: bool = False

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Geçerli bir IANA saat dilimi girin") from exc
        return value

    @field_validator("times")
    @classmethod
    def valid_times(cls, values: list[str]) -> list[str]:
        if any(not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value) for value in values):
            raise ValueError("Saatleri SS:DD biçiminde girin")
        return sorted(set(values))

    @model_validator(mode="after")
    def validate_enabled(self):
        if self.enabled and not self.times:
            raise ValueError("Etkin zamanlama için günlük bir saat seçin")
        return self

    def after(self, now: datetime) -> datetime | None:
        if not self.enabled:
            return None
        zone = ZoneInfo(self.timezone)
        day = now.astimezone(zone).date()
        while True:
            for value in self.times:
                local = datetime.combine(day, time.fromisoformat(value), zone)
                utc = local.astimezone(timezone.utc)
                # Kayıp yerel saat atlanır. Tekrarlanan saatin ilk karşılığı kullanılır.
                if utc > now and utc.astimezone(zone) == local:
                    return utc
            day += timedelta(days=1)
