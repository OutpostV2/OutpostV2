"""Validated inputs and typed outputs for live learning workflows."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrganizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=200)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Name must contain at least two characters")
        return value


class OrganizationOut(BaseModel):
    id: UUID
    name: str
    role: str


class TopicInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=1000)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Topic title must contain at least two characters")
        return value


class RoadmapInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=2000)
    topics: list[TopicInput] = Field(min_length=1, max_length=24)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Roadmap name must contain at least two characters")
        return value


class TopicOut(BaseModel):
    id: UUID
    title: str
    description: str
    week: int


class RoadmapOut(BaseModel):
    id: UUID
    organization_id: UUID
    name: str
    description: str
    version_id: UUID
    version_number: int
    topics: list[TopicOut]


class CohortInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=200)
    roadmap_version_id: UUID

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Cohort name must contain at least two characters")
        return value


class CohortOut(BaseModel):
    id: UUID
    organization_id: UUID
    name: str
    roadmap_version_id: UUID
    roadmap_name: str
    invite_code: str
    student_count: int


class JoinInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invite_code: str = Field(min_length=20, max_length=64)


class JoinedCohortOut(BaseModel):
    cohort_id: UUID
    cohort_name: str
    organization_name: str


class ProgressInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed: bool


class StudentTopicOut(TopicOut):
    completed: bool
    completed_at: datetime | None


class StudentLearningOut(BaseModel):
    cohort_id: UUID
    cohort_name: str
    organization_name: str
    roadmap_name: str
    completed: int
    total: int
    percent: int
    topics: list[StudentTopicOut]


class LearnerOut(BaseModel):
    id: UUID
    name: str
    completed: int
    total: int
    percent: int


class TopicStatOut(BaseModel):
    id: UUID
    title: str
    completed: int
    total: int
    percent: int


class CohortProgressOut(BaseModel):
    cohort_id: UUID
    cohort_name: str
    roadmap_name: str
    students: list[LearnerOut]
    topics: list[TopicStatOut]
    average_percent: int
