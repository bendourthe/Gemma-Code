"""Deterministic weighted progress accounting for an installer run."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

DEFAULT_STEP_WEIGHTS: Mapping[str, float] = {
    "ollama": 1.0,
    "extension": 0.5,
    "venv": 1.0,
    "model": 5.0,
    "desktop": 3.0,
    "runtime": 2.0,
    "hub-catalog": 0.5,
    "unsloth": 2.0,
}


def planned_steps(
    components: Iterable[str], *, include_unsloth: bool
) -> tuple[str, ...]:
    """Return the stable ordered denominator for one install attempt."""
    ordered = list(dict.fromkeys(str(step) for step in components if str(step)))
    for always_run in ("runtime", "hub-catalog"):
        if always_run not in ordered:
            ordered.append(always_run)
    if include_unsloth and "unsloth" not in ordered:
        ordered.append("unsloth")
    return tuple(ordered)


@dataclass
class WeightedInstallProgress:
    """Monotonic weighted progress for a fixed set of installer steps."""

    steps: tuple[str, ...]
    weights: Mapping[str, float] = field(default_factory=lambda: DEFAULT_STEP_WEIGHTS)
    _fractions: dict[str, float] = field(init=False, repr=False)
    _last: float = field(default=0.0, init=False, repr=False)

    def __post_init__(self) -> None:
        self.steps = tuple(dict.fromkeys(self.steps))
        self._fractions = {step: 0.0 for step in self.steps}

    def _weight(self, step: str) -> float:
        raw = float(self.weights.get(step, 1.0))
        return raw if math.isfinite(raw) and raw > 0 else 1.0

    @property
    def fraction(self) -> float:
        denominator = sum(self._weight(step) for step in self.steps)
        if denominator <= 0:
            return 0.0
        numerator = sum(
            self._weight(step) * self._fractions[step] for step in self.steps
        )
        return max(self._last, min(1.0, numerator / denominator))

    def update(self, step: str, fraction: float) -> float:
        """Advance one planned step and return the monotonic overall fraction."""
        if step not in self._fractions or not math.isfinite(float(fraction)):
            return self._last
        next_fraction = max(0.0, min(1.0, float(fraction)))
        self._fractions[step] = max(self._fractions[step], next_fraction)
        self._last = max(self._last, self.fraction)
        return self._last

    def complete(self, step: str) -> float:
        return self.update(step, 1.0)


__all__ = ["DEFAULT_STEP_WEIGHTS", "WeightedInstallProgress", "planned_steps"]
