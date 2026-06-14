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
    for name, spec in REGISTRY.items():
        assert spec.runtime("x").name == name
