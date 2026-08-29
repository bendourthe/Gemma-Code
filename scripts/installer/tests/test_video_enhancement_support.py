from __future__ import annotations

import json

from nexus_installer.video_enhancement_support import (
    ENV_KEY,
    INSTALLER_NOTE,
    SETTING_KEY,
    SETUP_COPY,
    support_contract_path,
)


def test_installer_copy_matches_core_support_contract() -> None:
    contract = json.loads(support_contract_path().read_text(encoding="utf-8"))
    assert contract["envKey"] == ENV_KEY
    assert contract["settingKey"] == SETTING_KEY
    assert contract["installerNote"] == INSTALLER_NOTE
    assert contract["setupCopy"] == SETUP_COPY
    assert contract["doesNotBundle"] is True
    assert contract["doesNotDownload"] is True
