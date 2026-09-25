"""Typed responses for the review demonstration scenario."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class TopicOut(BaseModel):
    key: str
    title: str
    description: str
    week: int
    status: Literal["not_started", "completed"]
    completed_at: datetime | None = None


class PhaseOut(BaseModel):
    title: str
    description: str
    topics: list[TopicOut]


class StudentOut(BaseModel):
    roadmap_title: str
    completed: int
    total: int
    percent: int
    next_topic: TopicOut | None
    phases: list[PhaseOut]


class CohortMemberOut(BaseModel):
    name: str
    completed: int
    total: int
    percent: int
    is_you: bool


class TopicStatOut(BaseModel):
    title: str
    completed: int
    total: int
    percent: int


class CoordinatorOut(BaseModel):
    cohort_title: str
    roadmap_title: str
    members: list[CohortMemberOut]
    average_percent: int
    topics: list[TopicStatOut]


class ReviewOverviewOut(BaseModel):
    scenario: Literal["illustrative"] = "illustrative"
    student: StudentOut
    coordinator: CoordinatorOut | None


class ProgressInput(BaseModel):
    completed: bool
