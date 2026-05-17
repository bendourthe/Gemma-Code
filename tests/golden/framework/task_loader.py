"""Load and filter golden task definitions from YAML."""

from __future__ import annotations

from pathlib import Path

try:
    import yaml
except ImportError as exc:  # pragma: no cover - hard dependency
    raise RuntimeError(
        "PyYAML is required: pip install pyyaml"
    ) from exc

from .models import GoldenTask, SuccessCriteria


def _parse_criteria(raw: list[dict]) -> list[SuccessCriteria]:
    criteria: list[SuccessCriteria] = []
    for item in raw or []:
        criteria.append(
            SuccessCriteria(
                type=str(item["type"]),
                target=str(item.get("target", "")),
                pattern=str(item.get("pattern", "")),
                description=str(item.get("description", "")),
            )
        )
    return criteria


def load_task(yaml_path: str | Path) -> GoldenTask:
    """Parse a YAML file into a GoldenTask dataclass."""
    path = Path(yaml_path)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected top-level mapping, got {type(data)}")

    required = ("id", "name", "category", "description", "initial_state")
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"{path}: missing required fields: {missing}")

    return GoldenTask(
        id=str(data["id"]),
        name=str(data["name"]),
        category=str(data["category"]),
        description=str(data["description"]),
        initial_state=str(data["initial_state"]),
        expected_files_changed=list(data.get("expected_files_changed", [])),
        success_criteria=_parse_criteria(data.get("success_criteria", [])),
        max_iterations=int(data.get("max_iterations", 20)),
        timeout_seconds=int(data.get("timeout_seconds", 300)),
        model_tier=str(data.get("model_tier", "any")),
        tags=list(data.get("tags", [])),
    )


def load_all_tasks(directory: str | Path) -> list[GoldenTask]:
    """Load every *.yaml / *.yml task definition in a directory."""
    root = Path(directory)
    if not root.is_dir():
        raise FileNotFoundError(f"Task directory not found: {root}")

    tasks: list[GoldenTask] = []
    for path in sorted(root.glob("*.y*ml")):
        if path.name.startswith("_"):
            continue
        tasks.append(load_task(path))
    return tasks


def by_category(tasks: list[GoldenTask], category: str) -> list[GoldenTask]:
    return [t for t in tasks if t.category == category]


def by_model_tier(tasks: list[GoldenTask], tier: str) -> list[GoldenTask]:
    """Filter tasks that can run on the given model tier.

    A task with model_tier="any" matches every tier. A task with a specific
    tier only matches that exact tier.
    """
    return [t for t in tasks if t.model_tier in ("any", tier)]


def by_tag(tasks: list[GoldenTask], tag: str) -> list[GoldenTask]:
    return [t for t in tasks if tag in t.tags]
