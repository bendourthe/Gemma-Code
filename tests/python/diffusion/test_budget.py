from runtimes.diffusion.budget import MemoryBudget, validate_budget


def test_validate_budget_rejects_vram_below_model_min():
    ok, errors, _warnings = validate_budget(
        MemoryBudget(3, 8, 1, False),
        model_min_vram_gb=6,
    )
    assert ok is False
    assert any("below the model minimum" in e for e in errors)


def test_validate_budget_allows_streaming_below_min():
    ok, errors, _warnings = validate_budget(
        MemoryBudget(3, 8, 1, True),
        model_min_vram_gb=6,
    )
    assert ok is True
    assert errors == []
