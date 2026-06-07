"""Point RUBBERDUCK_HOME at a throwaway dir for the whole test session so no
test writes to the developer's real ~/.rubberduck/."""

import os
import tempfile
from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True, scope="session")
def _isolated_home() -> Iterator[None]:
    with tempfile.TemporaryDirectory(prefix="rubberduck-test-") as d:
        prev = os.environ.get("RUBBERDUCK_HOME")
        os.environ["RUBBERDUCK_HOME"] = d
        try:
            yield
        finally:
            if prev is None:
                os.environ.pop("RUBBERDUCK_HOME", None)
            else:
                os.environ["RUBBERDUCK_HOME"] = prev
