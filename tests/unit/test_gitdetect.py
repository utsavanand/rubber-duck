from pathlib import Path

from rubberduck import gitdetect


def test_detects_repo_name_and_branch(git_repo: Path) -> None:
    gitdetect._cache.clear()
    info = gitdetect.detect(str(git_repo))
    assert info is not None
    assert info.repo_name == git_repo.name
    assert info.branch in ("main", "master")
    assert Path(info.repo_path).name == git_repo.name


def test_non_git_dir_returns_none(tmp_path: Path) -> None:
    gitdetect._cache.clear()
    plain = tmp_path / "plain"
    plain.mkdir()
    # A plain directory has no repo: detect returns None, and that None is what
    # gets cached (so we don't re-run git on every event for a non-repo cwd).
    assert gitdetect.detect(str(plain)) is None
    assert gitdetect._cache[str(plain)] is None


def test_result_is_cached_per_cwd(git_repo: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    gitdetect._cache.clear()
    calls = {"n": 0}
    real = gitdetect._detect_uncached

    def counting(cwd: str):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        return real(cwd)

    monkeypatch.setattr(gitdetect, "_detect_uncached", counting)
    gitdetect.detect(str(git_repo))
    gitdetect.detect(str(git_repo))
    assert calls["n"] == 1  # second call served from cache
