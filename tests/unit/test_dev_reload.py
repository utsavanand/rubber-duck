from rubberduck.dev_reload import _source_mtimes, changed_path


def test_source_mtimes_includes_the_package_modules() -> None:
    paths = _source_mtimes()
    assert any(p.endswith("dev_reload.py") for p in paths)
    assert any(p.endswith("server.py") for p in paths)


def test_changed_path_none_when_unchanged() -> None:
    snap = {"a.py": 1.0, "b.py": 2.0}
    assert changed_path(snap, dict(snap)) is None


def test_changed_path_detects_a_modified_file() -> None:
    before = {"a.py": 1.0, "b.py": 2.0}
    after = {"a.py": 1.0, "b.py": 2.5}  # b.py touched
    assert changed_path(before, after) == "b.py"


def test_changed_path_detects_a_new_file() -> None:
    before = {"a.py": 1.0}
    after = {"a.py": 1.0, "c.py": 3.0}
    assert changed_path(before, after) == "c.py"


def test_changed_path_detects_a_deleted_file() -> None:
    before = {"a.py": 1.0, "b.py": 2.0}
    after = {"a.py": 1.0}
    assert changed_path(before, after) == "b.py"
