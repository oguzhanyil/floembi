"""Windows hizmetinin anahtarı: kurulumun ACL ile kısıtladığı klasörde makine DPAPI'si."""

import base64
import ctypes
import json
import os
import tempfile
from ctypes import wintypes
from pathlib import Path

from nacl.public import PrivateKey


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data: bytes, *, decrypt=False) -> bytes:
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, result = Blob(len(data), buf), Blob()
    library = ctypes.WinDLL("crypt32", use_last_error=True)
    fn = library.CryptUnprotectData if decrypt else library.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                   wintypes.DWORD, ctypes.POINTER(Blob)]
    # CRYPTPROTECT_UI_FORBIDDEN, ayrıca şifrelerken CRYPTPROTECT_LOCAL_MACHINE
    if not fn(ctypes.byref(source), None, None, None, None, 1 if decrypt else 5, ctypes.byref(result)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(result.data)


def store_identity(path: Path, server: str, gateway_id: int, key: PrivateKey) -> None:
    payload = {"server": server, "gateway_id": gateway_id,
               "protected_key": base64.b64encode(protect(bytes(key))).decode("ascii")}
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as stream:
        temporary = Path(stream.name)
        json.dump(payload, stream)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_identity(path: Path):
    info = json.loads(path.read_text(encoding="utf-8"))
    key = protect(base64.b64decode(info["protected_key"], validate=True), decrypt=True)
    return info["server"], int(info["gateway_id"]), PrivateKey(key)
