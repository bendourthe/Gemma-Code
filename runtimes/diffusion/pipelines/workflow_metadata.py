"""Workflow JSON builder + PNG `iTXt` embedder with `tEXt` compat alias.

Mirrors `core/image/WorkflowMetadata.ts` in Python so a generated image
produced by the runtime carries the same `nexus_workflow` chunk that the
Node/TS side knows how to read. The Python side intentionally
re-implements the CRC + chunk writer rather than importing PIL.PngImagePlugin
so the runtime stays usable in environments without Pillow (smoke tests,
linting, CI).
"""

from __future__ import annotations

import json
import struct
import zlib
from typing import Any, Dict, List, Optional

from . import params as params_mod


PNG_SIGNATURE = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
TEXT_CHUNK_TYPE = b"tEXt"
ITXT_CHUNK_TYPE = b"iTXt"
IEND_CHUNK_TYPE = b"IEND"
NEXUS_WORKFLOW_KEY = b"nexus_workflow"
COMPAT_WORKFLOW_KEY = b"workflow"
RUNTIME_TOOL_NAME = "nexus"
RUNTIME_TOOL_VERSION = "1.0.0"


def minimal_png() -> bytes:
    """Return a deterministic 1x1 transparent PNG.

    Matches `createMinimalPng()` in the TS module so the round-trip tests
    can use either implementation as the source.
    """

    import base64

    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def _build_text_chunk(key: bytes, value: str) -> bytes:
    value_bytes = value.encode("utf-8")
    data = key + b"\x00" + value_bytes
    length = struct.pack(">I", len(data))
    crc = zlib.crc32(TEXT_CHUNK_TYPE + data) & 0xFFFFFFFF
    return length + TEXT_CHUNK_TYPE + data + struct.pack(">I", crc)


def _build_itxt_chunk(key: bytes, value: str) -> bytes:
    """Uncompressed PNG iTXt: keyword, NUL, flag 0, method 0, empty lang/trans, UTF-8."""
    data = key + b"\x00\x00\x00\x00\x00" + value.encode("utf-8")
    length = struct.pack(">I", len(data))
    crc = zlib.crc32(ITXT_CHUNK_TYPE + data) & 0xFFFFFFFF
    return length + ITXT_CHUNK_TYPE + data + struct.pack(">I", crc)


def _read_chunks(buffer: bytes) -> List[Dict[str, Any]]:
    if buffer[:8] != PNG_SIGNATURE:
        raise ValueError("not a PNG buffer")
    chunks: List[Dict[str, Any]] = []
    offset = 8
    while offset < len(buffer):
        if offset + 8 > len(buffer):
            break
        (length,) = struct.unpack(">I", buffer[offset : offset + 4])
        offset += 4
        chunk_type = buffer[offset : offset + 4]
        offset += 4
        if offset + length + 4 > len(buffer):
            raise ValueError("malformed PNG chunk")
        data = buffer[offset : offset + length]
        offset += length
        offset += 4  # CRC skipped on read
        chunks.append({"type": chunk_type, "data": data})
        if chunk_type == IEND_CHUNK_TYPE:
            break
    return chunks


def _serialize_chunk(chunk: Dict[str, Any]) -> bytes:
    data = chunk["data"]
    type_ = chunk["type"]
    length = struct.pack(">I", len(data))
    crc = zlib.crc32(type_ + data) & 0xFFFFFFFF
    return length + type_ + data + struct.pack(">I", crc)


def build_workflow(
    mode: str,
    params_obj: params_mod.PipelineParams,
    timestamp: str,
) -> Dict[str, Any]:
    workflow: Dict[str, Any] = {
        "tool": RUNTIME_TOOL_NAME,
        "version": RUNTIME_TOOL_VERSION,
        "mode": mode,
        "prompt": params_obj.prompt,
        "negativePrompt": params_obj.negative_prompt,
        "modelId": params_obj.model_id,
        "width": params_obj.width,
        "height": params_obj.height,
        "steps": params_obj.steps,
        "cfgScale": params_obj.cfg_scale,
        "sampler": params_obj.sampler,
        "seed": params_obj.seed,
        "timestamp": timestamp,
        "schemaVersion": 1,
        "loras": [
            {"id": lora.id, "weight": lora.weight} for lora in params_obj.loras
        ],
    }
    if params_obj.control_net is not None:
        workflow["controlNet"] = {
            "modelId": params_obj.control_net.model_id,
            "weight": params_obj.control_net.weight,
            "preprocessor": params_obj.control_net.preprocessor,
        }
    if params_obj.source_image is not None:
        workflow["sourceImageHash"] = _short_hash(params_obj.source_image)
    if params_obj.mask is not None:
        workflow["maskHash"] = _short_hash(params_obj.mask)
    if params_obj.direction is not None:
        workflow["direction"] = params_obj.direction
    if params_obj.pixels is not None:
        workflow["pixels"] = params_obj.pixels
    if params_obj.strength is not None:
        workflow["strength"] = params_obj.strength
    return workflow


def embed_workflow(png_bytes: bytes, workflow: Dict[str, Any]) -> bytes:
    if not png_bytes.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG buffer")
    chunks = _read_chunks(png_bytes)
    if not chunks or chunks[-1]["type"] != IEND_CHUNK_TYPE:
        raise ValueError("PNG missing IEND terminator")
    # Strip existing workflow chunks so the embed is idempotent.
    filtered = []
    for chunk in chunks:
        if chunk["type"] in (TEXT_CHUNK_TYPE, ITXT_CHUNK_TYPE) and _is_workflow_chunk(
            chunk["type"], chunk["data"]
        ):
            continue
        filtered.append(chunk)
    json_text = json.dumps(workflow, sort_keys=True)
    nexus_itxt = _build_itxt_chunk(NEXUS_WORKFLOW_KEY, json_text)
    nexus_text = _build_text_chunk(NEXUS_WORKFLOW_KEY, json_text)
    compat_chunk = _build_text_chunk(COMPAT_WORKFLOW_KEY, json_text)
    head = [PNG_SIGNATURE]
    iend: Optional[Dict[str, Any]] = None
    for chunk in filtered:
        if chunk["type"] == IEND_CHUNK_TYPE:
            iend = chunk
            break
        head.append(_serialize_chunk(chunk))
    if iend is None:
        raise ValueError("PNG missing IEND terminator")
    return b"".join(head + [nexus_itxt, nexus_text, compat_chunk, _serialize_chunk(iend)])


def _keyword(data: bytes) -> bytes:
    null = data.find(b"\x00")
    if null < 0:
        return b""
    return data[:null]


def _is_workflow_chunk(_chunk_type: bytes, data: bytes) -> bool:
    return _keyword(data) in (NEXUS_WORKFLOW_KEY, COMPAT_WORKFLOW_KEY)


def extract_workflow(png_bytes: bytes) -> Optional[Dict[str, Any]]:
    try:
        chunks = _read_chunks(png_bytes)
    except ValueError:
        return None
    for key in (NEXUS_WORKFLOW_KEY, COMPAT_WORKFLOW_KEY):
        for prefer_itxt in (True, False):
            wanted = ITXT_CHUNK_TYPE if prefer_itxt else TEXT_CHUNK_TYPE
            for chunk in chunks:
                if chunk["type"] != wanted:
                    continue
                null = chunk["data"].find(b"\x00")
                if null < 0:
                    continue
                if chunk["data"][:null] != key:
                    continue
                payload = chunk["data"][null + 1 :]
                if wanted == ITXT_CHUNK_TYPE:
                    # skip compression flag, method, lang NUL, trans NUL
                    if len(payload) < 4:
                        continue
                    rest = payload[2:]
                    lang_end = rest.find(b"\x00")
                    if lang_end < 0:
                        continue
                    trans = rest[lang_end + 1 :]
                    trans_end = trans.find(b"\x00")
                    if trans_end < 0:
                        continue
                    payload = trans[trans_end + 1 :]
                try:
                    parsed = json.loads(payload.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if isinstance(parsed, dict) and parsed.get("mode") in {
                    "txt2img",
                    "img2img",
                    "inpaint",
                    "outpaint",
                }:
                    return parsed
    return None


def _short_hash(payload: str) -> str:
    """Stable short identifier for an opaque base64 payload.

    The full source image is *not* embedded in metadata (would inflate
    every output by ~MBs); we keep only a SHA-1 prefix so the workflow
    can claim "this output derived from source <hash>" without
    duplicating the source bytes.
    """

    import hashlib

    return hashlib.sha1(payload.encode("utf-8", errors="ignore")).hexdigest()[:16]
