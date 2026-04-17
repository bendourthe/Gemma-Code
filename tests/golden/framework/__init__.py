"""Golden task evaluation framework.

Loads task definitions, runs them against the agent loop, evaluates
success criteria, and reports results.

Intended to be run from tests/golden/ as working directory, so imports
are relative to that package root (framework.*).
"""

from .types import GoldenTask, SuccessCriteria, TaskResult  # noqa: F401
