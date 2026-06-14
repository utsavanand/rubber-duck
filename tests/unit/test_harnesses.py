from rubberduck.harnesses import REGISTRY, installable_agents, runtime_for


def test_runtime_for_resolves_each_agent() -> None:
    assert runtime_for("claude-code", "claude").name == "claude-code"
    assert runtime_for("codex", "codex").name == "codex"
    assert runtime_for("copilot", "copilot").name == "copilot"


def test_runtime_for_unknown_falls_back_to_generic() -> None:
    assert runtime_for("nope", "aider").name == "generic"
    assert runtime_for(None, "aider").name == "generic"


def test_installable_agents_excludes_generic() -> None:
    # generic has no hook adapter, so it can't be wired for watched sessions.
    agents = installable_agents()
    assert "generic" not in agents
    assert {"claude-code", "codex", "copilot"} <= set(agents)


def test_every_registry_entry_builds_a_runtime() -> None:
    for name, cls in REGISTRY.items():
        assert cls("x").name == name


def test_installable_agents_carry_a_hook_spec() -> None:
    for name in installable_agents():
        spec = REGISTRY[name].hook_spec
        assert spec is not None
        # build/strip round-trip: stripping a freshly built config removes
        # exactly our entries, leaving nothing behind.
        built = spec.build({}, "/path/to/rubberduck-hook.sh", name)
        assert spec.strip(built) == {}
