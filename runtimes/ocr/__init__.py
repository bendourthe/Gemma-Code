"""
v1.16.0 Phase 3 (adoption item A5) -- Nexus document-OCR runtime.

The second Python runtime in the repo (after `runtimes/diffusion`), speaking the
same line-delimited JSON-RPC 2.0 protocol over stdin/stdout so the Node sidecar
drives both through one client shape.

Engines live behind one runtime:

  * ``rapidocr``       -- ONNX Runtime detect-then-recognize. CPU-only, tiny, and
                          cross-platform (Windows / macOS Intel + Apple Silicon /
                          Linux), so document parsing works on every supported
                          host. Apache-2.0.
  * ``unlimited-ocr``  -- a 3B vision-language model that parses whole documents
                          with layout. CUDA-first, MIT, and the only path that
                          executes repo-supplied code (``trust_remote_code``),
                          which is why its catalog entry MUST pin a commit sha
                          and why that code only ever runs inside this sandboxed
                          Python process -- never in the Node sidecar.
  * ``docx`` / ``pptx`` / ``xlsx`` -- native Office Open XML (python-docx,
                          python-pptx, openpyxl). No OCR weights and no Docling.

Every heavy import (torch, transformers, rapidocr, pypdfium2) is deferred to
first use so ``health`` and ``version`` answer on a bare CI host with nothing
installed.
"""
