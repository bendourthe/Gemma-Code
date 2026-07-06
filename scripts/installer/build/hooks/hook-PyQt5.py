"""PyInstaller hook for PyQt5: ensure Qt plugins and QSS assets are included."""

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hiddenimports = collect_submodules("PyQt5")
datas = collect_data_files("PyQt5", include_py_files=False)
