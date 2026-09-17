from importlib.metadata import version

from app import __version__


def test_package_version_matches_installed_metadata() -> None:
    assert __version__ == version("outpost-backend")
