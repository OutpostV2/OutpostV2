"""Version 1 API router."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.modules.auth.router import router as auth_router
from app.modules.auth.router import user_router


class ApiVersion(BaseModel):
    """Version discovery response."""

    name: Literal["Outpost API"] = "Outpost API"
    version: Literal["v1"] = "v1"


router = APIRouter(prefix="/api/v1", tags=["system"])


@router.get("", response_model=ApiVersion)
def api_version() -> ApiVersion:
    """Describe the mounted product API version."""

    return ApiVersion()


router.include_router(auth_router)

router.include_router(user_router)
