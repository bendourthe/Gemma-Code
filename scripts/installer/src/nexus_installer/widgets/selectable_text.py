"""Make every QLabel's text mouse-selectable.

Applied by walking a widget tree after it is built or rebuilt (the window does
it on every page switch; the pages that rebuild labels later -- the model
catalog, the review summary -- call it themselves). An application-wide event
filter would have been more automatic, but a Python-side filter that sees
every event of every object crashed the process while Qt tore widgets down.

Labels inside the clickable sidebar help box are left alone so the whole box
still opens the docs on click.
"""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QLabel, QWidget

#: Object names whose descendant labels must stay click-through.
_CLICK_THROUGH_HOSTS = frozenset({"helpBox"})


def _inside_click_through_host(widget: QWidget) -> bool:
    parent = widget.parentWidget()
    while parent is not None:
        if parent.objectName() in _CLICK_THROUGH_HOSTS:
            return True
        parent = parent.parentWidget()
    return False


def make_selectable(label: QLabel) -> None:
    """Add mouse selection (and clickable links) to one label."""
    if _inside_click_through_host(label):
        return
    label.setTextInteractionFlags(
        label.textInteractionFlags()
        | Qt.TextInteractionFlag.TextSelectableByMouse
        | Qt.TextInteractionFlag.LinksAccessibleByMouse
    )


def make_labels_selectable(root: QWidget) -> int:
    """Make every QLabel under `root` (inclusive) selectable; return the count."""
    labels = root.findChildren(QLabel)
    if isinstance(root, QLabel):
        labels.append(root)
    for label in labels:
        make_selectable(label)
    return len(labels)
