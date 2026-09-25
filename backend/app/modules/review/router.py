"""A small, honest review scenario with per-user persisted interactions.

The roadmap and peer learners are illustrative fixtures. Only the authenticated
user's topic completion is stored; no organization or cohort is created here.
"""

from uuid import UUID

from fastapi import APIRouter, Response
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.core.errors import ForbiddenError, NotFoundError
from app.modules.auth.dependencies import CurrentAuth, DatabaseSession
from app.modules.review.models import ReviewTopicProgress
from app.modules.review.schemas import (
    CohortMemberOut,
    CoordinatorOut,
    PhaseOut,
    ProgressInput,
    ReviewOverviewOut,
    StudentOut,
    TopicOut,
    TopicStatOut,
)
from app.modules.users.models import AccountType

router = APIRouter(prefix="/review", tags=["review scenario"])

ROADMAP_TITLE = "Career Readiness Foundations"
COHORT_TITLE = "Career Readiness · Example Cohort"
PHASES = (
    (
        "Find your direction",
        "Understand your strengths and set a clear starting point.",
        (
            (
                "goals",
                "Set your career goals",
                "Define two roles to explore and the skills they require.",
                1,
            ),
            (
                "communication",
                "Communicate with confidence",
                "Practice a concise introduction and clear professional writing.",
                2,
            ),
        ),
    ),
    (
        "Build your evidence",
        "Turn learning into work you can show.",
        (
            (
                "project",
                "Complete a practical project",
                "Create a small project that demonstrates your skills.",
                3,
            ),
            (
                "portfolio",
                "Present your work",
                "Summarize your project in a portfolio-ready case study.",
                4,
            ),
        ),
    ),
    (
        "Prepare for opportunities",
        "Get ready to apply, interview, and improve.",
        (
            ("resume", "Refine your résumé", "Connect your experience to a role with evidence.", 5),
            (
                "interview",
                "Practice an interview",
                "Rehearse responses and identify the next improvement.",
                6,
            ),
        ),
    ),
)
TOPICS = tuple(topic for _, _, topics in PHASES for topic in topics)
TOPIC_KEYS = frozenset(topic[0] for topic in TOPICS)
SAMPLE_PEERS = (
    ("Anika Sharma", frozenset({"goals", "communication", "project", "portfolio", "resume"})),
    ("Rohan Mehta", frozenset({"goals", "communication", "project"})),
    ("Sara Khan", frozenset({"goals"})),
)


def _completed_for_user(session: DatabaseSession, user_id: UUID) -> dict[str, ReviewTopicProgress]:
    rows = session.scalars(
        select(ReviewTopicProgress).where(ReviewTopicProgress.user_id == user_id)
    ).all()
    return {row.topic_key: row for row in rows if row.topic_key in TOPIC_KEYS}


def _overview(
    session: DatabaseSession, user_id: UUID, display_name: str, *, include_coordinator: bool
) -> ReviewOverviewOut:
    completed_rows = _completed_for_user(session, user_id)
    completed_keys = frozenset(completed_rows)
    phases: list[PhaseOut] = []
    all_topics: list[TopicOut] = []
    for phase_title, phase_description, topic_specs in PHASES:
        topics = [
            TopicOut(
                key=key,
                title=title,
                description=description,
                week=week,
                status="completed" if key in completed_keys else "not_started",
                completed_at=completed_rows[key].completed_at if key in completed_rows else None,
            )
            for key, title, description, week in topic_specs
        ]
        phases.append(PhaseOut(title=phase_title, description=phase_description, topics=topics))
        all_topics.extend(topics)

    total = len(TOPICS)
    completed = len(completed_keys)
    student = StudentOut(
        roadmap_title=ROADMAP_TITLE,
        completed=completed,
        total=total,
        percent=round(completed * 100 / total),
        next_topic=next((topic for topic in all_topics if topic.status == "not_started"), None),
        phases=phases,
    )
    members = [
        CohortMemberOut(
            name=display_name,
            completed=completed,
            total=total,
            percent=student.percent,
            is_you=True,
        )
    ]
    members.extend(
        CohortMemberOut(
            name=name,
            completed=len(keys),
            total=total,
            percent=round(len(keys) * 100 / total),
            is_you=False,
        )
        for name, keys in SAMPLE_PEERS
    )
    topic_stats = [
        TopicStatOut(
            title=title,
            completed=int(key in completed_keys) + sum(key in keys for _, keys in SAMPLE_PEERS),
            total=len(members),
            percent=round(
                100
                * (int(key in completed_keys) + sum(key in keys for _, keys in SAMPLE_PEERS))
                / len(members)
            ),
        )
        for key, title, _, _ in TOPICS
    ]
    coordinator = CoordinatorOut(
        cohort_title=COHORT_TITLE,
        roadmap_title=ROADMAP_TITLE,
        members=members,
        average_percent=round(sum(member.percent for member in members) / len(members)),
        topics=topic_stats,
    )
    return ReviewOverviewOut(
        student=student, coordinator=coordinator if include_coordinator else None
    )


@router.get("/overview", response_model=ReviewOverviewOut)
def review_overview(
    auth: CurrentAuth, session: DatabaseSession, response: Response
) -> ReviewOverviewOut:
    response.headers["Cache-Control"] = "no-store"
    return _overview(
        session,
        auth[0].id,
        auth[0].display_name,
        include_coordinator=auth[0].account_type == AccountType.COORDINATOR,
    )


@router.put("/progress/{topic_key}", response_model=ReviewOverviewOut)
def update_review_progress(
    topic_key: str,
    data: ProgressInput,
    auth: CurrentAuth,
    session: DatabaseSession,
    response: Response,
) -> ReviewOverviewOut:
    if auth[0].account_type != AccountType.STUDENT:
        raise ForbiddenError("Student account required")
    if topic_key not in TOPIC_KEYS:
        raise NotFoundError("Review topic not found")
    user_id = auth[0].id
    if data.completed:
        session.execute(
            insert(ReviewTopicProgress)
            .values(user_id=user_id, topic_key=topic_key)
            .on_conflict_do_nothing(index_elements=["user_id", "topic_key"])
        )
    else:
        session.execute(
            delete(ReviewTopicProgress).where(
                ReviewTopicProgress.user_id == user_id,
                ReviewTopicProgress.topic_key == topic_key,
            )
        )
    session.commit()
    response.headers["Cache-Control"] = "no-store"
    return _overview(session, user_id, auth[0].display_name, include_coordinator=False)


@router.delete("/progress", status_code=204)
def reset_review_progress(auth: CurrentAuth, session: DatabaseSession) -> Response:
    if auth[0].account_type != AccountType.STUDENT:
        raise ForbiddenError("Student account required")
    session.execute(delete(ReviewTopicProgress).where(ReviewTopicProgress.user_id == auth[0].id))
    session.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
