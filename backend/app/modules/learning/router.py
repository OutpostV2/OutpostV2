"""Authenticated organization, cohort, and learning-progress API."""

import re
import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Response
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.modules.auth.dependencies import CurrentAuth, DatabaseSession
from app.modules.learning.models import (
    Cohort,
    CohortEnrollment,
    Organization,
    OrganizationMembership,
    Phase,
    Roadmap,
    RoadmapVersion,
    Topic,
    TopicProgress,
    Week,
)
from app.modules.learning.schemas import (
    CohortInput,
    CohortOut,
    CohortProgressOut,
    JoinedCohortOut,
    JoinInput,
    LearnerOut,
    OrganizationInput,
    OrganizationOut,
    ProgressInput,
    RoadmapInput,
    RoadmapOut,
    StudentLearningOut,
    StudentTopicOut,
    TopicOut,
    TopicStatOut,
)
from app.modules.users.models import AccountType, User

organizations_router = APIRouter(prefix="/organizations", tags=["live learning"])
cohorts_router = APIRouter(prefix="/cohorts", tags=["live learning"])
progress_router = APIRouter(prefix="/progress", tags=["live learning"])


def _coordinator(user: User) -> None:
    if user.account_type != AccountType.COORDINATOR:
        raise ForbiddenError("Coordinator account required")


def _student(user: User) -> None:
    if user.account_type != AccountType.STUDENT:
        raise ForbiddenError("Student account required")


def _owner(session: Session, user: User, organization_id: UUID) -> Organization:
    _coordinator(user)
    organization = session.get(Organization, organization_id)
    membership = session.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.role == "owner",
            OrganizationMembership.status == "active",
        )
    )
    if organization is None or organization.status != "active" or membership is None:
        raise ForbiddenError("Organization access denied")
    return organization


def _topics(session: Session, version_id: UUID) -> list[TopicOut]:
    rows = session.execute(
        select(Topic, Week.order_index)
        .join(Week, Topic.week_id == Week.id)
        .join(Phase, Week.phase_id == Phase.id)
        .where(Phase.roadmap_version_id == version_id)
        .order_by(Phase.order_index, Week.order_index, Topic.order_index)
    ).all()
    return [
        TopicOut(
            id=topic.id,
            title=topic.title,
            description=topic.description,
            week=week_number,
        )
        for topic, week_number in rows
    ]


def _roadmap_out(session: Session, roadmap: Roadmap, version: RoadmapVersion) -> RoadmapOut:
    return RoadmapOut(
        id=roadmap.id,
        organization_id=roadmap.organization_id,
        name=roadmap.name,
        description=roadmap.description,
        version_id=version.id,
        version_number=version.version_number,
        topics=_topics(session, version.id),
    )


def _cohort_out(session: Session, cohort: Cohort) -> CohortOut:
    roadmap_name = session.scalar(
        select(Roadmap.name)
        .join(RoadmapVersion, RoadmapVersion.roadmap_id == Roadmap.id)
        .where(RoadmapVersion.id == cohort.roadmap_version_id)
    )
    count = session.scalar(
        select(func.count(CohortEnrollment.id)).where(
            CohortEnrollment.cohort_id == cohort.id,
            CohortEnrollment.status == "active",
        )
    )
    return CohortOut(
        id=cohort.id,
        organization_id=cohort.organization_id,
        name=cohort.name,
        roadmap_version_id=cohort.roadmap_version_id,
        roadmap_name=roadmap_name or "Roadmap",
        invite_code=cohort.invite_code,
        student_count=count or 0,
    )


@organizations_router.post("", response_model=OrganizationOut, status_code=201)
def create_organization(
    data: OrganizationInput, auth: CurrentAuth, session: DatabaseSession
) -> OrganizationOut:
    user = auth[0]
    _coordinator(user)
    slug_base = re.sub(r"[^a-z0-9]+", "-", data.name.lower()).strip("-")[:190] or "organization"
    organization = Organization(name=data.name, slug=f"{slug_base}-{secrets.token_hex(5)}")
    session.add(organization)
    session.flush()
    session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=user.id,
            role="owner",
        )
    )
    session.commit()
    return OrganizationOut(id=organization.id, name=organization.name, role="owner")


@organizations_router.get("", response_model=list[OrganizationOut])
def list_organizations(auth: CurrentAuth, session: DatabaseSession) -> list[OrganizationOut]:
    rows = session.execute(
        select(Organization, OrganizationMembership.role)
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == Organization.id,
        )
        .where(
            OrganizationMembership.user_id == auth[0].id,
            OrganizationMembership.status == "active",
            Organization.status == "active",
        )
        .order_by(Organization.created_at, Organization.id)
    ).all()
    return [
        OrganizationOut(id=organization.id, name=organization.name, role=role)
        for organization, role in rows
    ]


@organizations_router.post(
    "/{organization_id}/roadmaps", response_model=RoadmapOut, status_code=201
)
def create_roadmap(
    organization_id: UUID,
    data: RoadmapInput,
    auth: CurrentAuth,
    session: DatabaseSession,
) -> RoadmapOut:
    _owner(session, auth[0], organization_id)
    roadmap = Roadmap(
        organization_id=organization_id,
        name=data.name,
        description=data.description.strip(),
        created_by=auth[0].id,
    )
    session.add(roadmap)
    session.flush()
    version = RoadmapVersion(
        roadmap_id=roadmap.id,
        version_number=1,
        status="published",
        created_by=auth[0].id,
        published_at=datetime.now(UTC),
    )
    session.add(version)
    session.flush()
    phase = Phase(roadmap_version_id=version.id, title="Learning path", order_index=1)
    session.add(phase)
    session.flush()
    for index, item in enumerate(data.topics, start=1):
        week = Week(phase_id=phase.id, title=f"Week {index}", order_index=index)
        session.add(week)
        session.flush()
        session.add(
            Topic(
                week_id=week.id,
                title=item.title,
                description=item.description.strip(),
                order_index=1,
            )
        )
    session.flush()
    session.commit()
    return _roadmap_out(session, roadmap, version)


@organizations_router.get("/{organization_id}/roadmaps", response_model=list[RoadmapOut])
def list_roadmaps(
    organization_id: UUID, auth: CurrentAuth, session: DatabaseSession
) -> list[RoadmapOut]:
    _owner(session, auth[0], organization_id)
    rows = session.execute(
        select(Roadmap, RoadmapVersion)
        .join(RoadmapVersion, RoadmapVersion.roadmap_id == Roadmap.id)
        .where(
            Roadmap.organization_id == organization_id,
            RoadmapVersion.status == "published",
        )
        .order_by(Roadmap.created_at, Roadmap.id)
    ).all()
    return [_roadmap_out(session, roadmap, version) for roadmap, version in rows]


@organizations_router.post("/{organization_id}/cohorts", response_model=CohortOut, status_code=201)
def create_cohort(
    organization_id: UUID,
    data: CohortInput,
    auth: CurrentAuth,
    session: DatabaseSession,
) -> CohortOut:
    _owner(session, auth[0], organization_id)
    version = session.get(RoadmapVersion, data.roadmap_version_id)
    roadmap = session.get(Roadmap, version.roadmap_id) if version is not None else None
    if (
        version is None
        or roadmap is None
        or roadmap.organization_id != organization_id
        or version.status != "published"
    ):
        raise NotFoundError("Published roadmap version not found")
    cohort = Cohort(
        organization_id=organization_id,
        roadmap_version_id=version.id,
        name=data.name.strip(),
        created_by=auth[0].id,
        invite_code=secrets.token_urlsafe(24),
    )
    session.add(cohort)
    session.commit()
    return _cohort_out(session, cohort)


@organizations_router.get("/{organization_id}/cohorts", response_model=list[CohortOut])
def list_cohorts(
    organization_id: UUID, auth: CurrentAuth, session: DatabaseSession
) -> list[CohortOut]:
    _owner(session, auth[0], organization_id)
    cohorts = session.scalars(
        select(Cohort)
        .where(Cohort.organization_id == organization_id, Cohort.status == "active")
        .order_by(Cohort.created_at, Cohort.id)
    ).all()
    return [_cohort_out(session, cohort) for cohort in cohorts]


@cohorts_router.post("/join", response_model=JoinedCohortOut)
def join_cohort(data: JoinInput, auth: CurrentAuth, session: DatabaseSession) -> JoinedCohortOut:
    user = auth[0]
    _student(user)
    cohort = session.scalar(
        select(Cohort).where(
            Cohort.invite_code == data.invite_code.strip(),
            Cohort.status == "active",
        )
    )
    if cohort is None:
        raise NotFoundError("Cohort invite not found")
    organization = session.get(Organization, cohort.organization_id)
    if organization is None or organization.status != "active":
        raise NotFoundError("Cohort invite not found")
    session.execute(
        insert(OrganizationMembership)
        .values(organization_id=organization.id, user_id=user.id, role="student")
        .on_conflict_do_nothing(index_elements=["organization_id", "user_id"])
    )
    session.execute(
        insert(CohortEnrollment)
        .values(cohort_id=cohort.id, user_id=user.id)
        .on_conflict_do_nothing(index_elements=["cohort_id", "user_id"])
    )
    session.commit()
    return JoinedCohortOut(
        cohort_id=cohort.id,
        cohort_name=cohort.name,
        organization_name=organization.name,
    )


@progress_router.get("/me", response_model=list[StudentLearningOut])
def my_learning(
    auth: CurrentAuth, session: DatabaseSession, response: Response
) -> list[StudentLearningOut]:
    user = auth[0]
    _student(user)
    response.headers["Cache-Control"] = "no-store"
    rows = session.execute(
        select(Cohort, Organization.name, Roadmap.name)
        .join(CohortEnrollment, CohortEnrollment.cohort_id == Cohort.id)
        .join(Organization, Organization.id == Cohort.organization_id)
        .join(RoadmapVersion, RoadmapVersion.id == Cohort.roadmap_version_id)
        .join(Roadmap, Roadmap.id == RoadmapVersion.roadmap_id)
        .where(
            CohortEnrollment.user_id == user.id,
            CohortEnrollment.status == "active",
            Cohort.status == "active",
            Organization.status == "active",
        )
        .order_by(Cohort.created_at, Cohort.id)
    ).all()
    result: list[StudentLearningOut] = []
    for cohort, organization_name, roadmap_name in rows:
        topics = _topics(session, cohort.roadmap_version_id)
        topic_ids = [topic.id for topic in topics]
        progress = (
            {
                row.topic_id: row
                for row in session.scalars(
                    select(TopicProgress).where(
                        TopicProgress.user_id == user.id,
                        TopicProgress.topic_id.in_(topic_ids),
                    )
                ).all()
            }
            if topic_ids
            else {}
        )
        topic_outputs = [
            StudentTopicOut(
                **topic.model_dump(),
                completed=topic.id in progress,
                completed_at=progress[topic.id].updated_at if topic.id in progress else None,
            )
            for topic in topics
        ]
        completed = len(progress)
        result.append(
            StudentLearningOut(
                cohort_id=cohort.id,
                cohort_name=cohort.name,
                organization_name=organization_name,
                roadmap_name=roadmap_name,
                completed=completed,
                total=len(topics),
                percent=round(100 * completed / len(topics)) if topics else 0,
                topics=topic_outputs,
            )
        )
    return result


@progress_router.put("/topics/{topic_id}", status_code=204)
def set_topic_progress(
    topic_id: UUID,
    data: ProgressInput,
    auth: CurrentAuth,
    session: DatabaseSession,
) -> Response:
    user = auth[0]
    _student(user)
    cohort_id = session.scalar(
        select(Cohort.id)
        .join(CohortEnrollment, CohortEnrollment.cohort_id == Cohort.id)
        .join(RoadmapVersion, RoadmapVersion.id == Cohort.roadmap_version_id)
        .join(Phase, Phase.roadmap_version_id == RoadmapVersion.id)
        .join(Week, Week.phase_id == Phase.id)
        .join(Topic, Topic.week_id == Week.id)
        .where(
            Topic.id == topic_id,
            CohortEnrollment.user_id == user.id,
            CohortEnrollment.status == "active",
            Cohort.status == "active",
        )
        .limit(1)
    )
    if cohort_id is None:
        raise NotFoundError("Assigned topic not found")
    if data.completed:
        session.execute(
            insert(TopicProgress)
            .values(user_id=user.id, topic_id=topic_id, status="completed")
            .on_conflict_do_update(
                index_elements=["user_id", "topic_id"],
                set_={"status": "completed", "updated_at": func.now()},
            )
        )
    else:
        session.execute(
            delete(TopicProgress).where(
                TopicProgress.user_id == user.id,
                TopicProgress.topic_id == topic_id,
            )
        )
    session.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@cohorts_router.get("/{cohort_id}/progress", response_model=CohortProgressOut)
def cohort_progress(
    cohort_id: UUID,
    auth: CurrentAuth,
    session: DatabaseSession,
    response: Response,
) -> CohortProgressOut:
    cohort = session.get(Cohort, cohort_id)
    if cohort is None or cohort.status != "active":
        raise NotFoundError("Cohort not found")
    _owner(session, auth[0], cohort.organization_id)
    response.headers["Cache-Control"] = "no-store"
    roadmap_name = (
        session.scalar(
            select(Roadmap.name)
            .join(RoadmapVersion, RoadmapVersion.roadmap_id == Roadmap.id)
            .where(RoadmapVersion.id == cohort.roadmap_version_id)
        )
        or "Roadmap"
    )
    topics = _topics(session, cohort.roadmap_version_id)
    students = session.scalars(
        select(User)
        .join(CohortEnrollment, CohortEnrollment.user_id == User.id)
        .where(
            CohortEnrollment.cohort_id == cohort.id,
            CohortEnrollment.status == "active",
        )
        .order_by(User.display_name, User.id)
    ).all()
    student_ids = [student.id for student in students]
    topic_ids = [topic.id for topic in topics]
    progress = (
        {
            (row.user_id, row.topic_id)
            for row in session.scalars(
                select(TopicProgress).where(
                    TopicProgress.user_id.in_(student_ids),
                    TopicProgress.topic_id.in_(topic_ids),
                    TopicProgress.status == "completed",
                )
            ).all()
        }
        if student_ids and topic_ids
        else set()
    )
    learners = [
        LearnerOut(
            id=student.id,
            name=student.display_name,
            completed=sum((student.id, topic.id) in progress for topic in topics),
            total=len(topics),
            percent=round(
                100 * sum((student.id, topic.id) in progress for topic in topics) / len(topics)
            )
            if topics
            else 0,
        )
        for student in students
    ]
    topic_stats = [
        TopicStatOut(
            id=topic.id,
            title=topic.title,
            completed=sum((student.id, topic.id) in progress for student in students),
            total=len(students),
            percent=round(
                100
                * sum((student.id, topic.id) in progress for student in students)
                / len(students)
            )
            if students
            else 0,
        )
        for topic in topics
    ]
    return CohortProgressOut(
        cohort_id=cohort.id,
        cohort_name=cohort.name,
        roadmap_name=roadmap_name,
        students=learners,
        topics=topic_stats,
        average_percent=round(sum(item.percent for item in learners) / len(learners))
        if learners
        else 0,
    )
