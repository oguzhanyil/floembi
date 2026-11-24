"""Floemdata Analytics tüketicisi için BI'ın yetkili ölçü API'si (standart kütüphane)."""

import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def report_metric(base_url: str, report_id: int, token: str, metric_id: str, filters: list[dict],
                  *, snapshot: str | None = None, evidence: dict | None = None) -> dict:
    """Kullanıcının BI oturumu ile hesaplanan kapsamı, değeri ve eşikleri birlikte döndürür."""
    origin = urlsplit(base_url)
    if (not origin.hostname or origin.username or origin.password or origin.path.strip("/")
            or origin.query or origin.fragment or not (origin.scheme == "https" or
                (origin.scheme == "http" and origin.hostname in {"localhost", "127.0.0.1", "::1"}))):
        raise ValueError("BI sunucusu HTTPS alan adı veya yerel HTTP adresi olmalı")
    if type(report_id) is not int or report_id <= 0 or not token or not metric_id:
        raise ValueError("Rapor, oturum ve katalog ölçüsü gerekli")
    query = {"metricId": metric_id}
    if snapshot is not None:
        query["snapshot"] = snapshot
    if evidence is not None:
        query["evidence"] = {k: evidence[k] for k in
            ("protocol", "metricId", "metricVersion", "snapshot", "contextHash", "dataTime", "value")}
    request = Request(f"{base_url.rstrip('/')}/api/reports/{report_id}/query",
                      json.dumps({"analytics": query, "filters": filters}, allow_nan=False).encode(),
                      {"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=30) as response:
            receipt = json.load(response)["analytics"]
    except HTTPError as exc:
        try:
            message = json.load(exc).get("error", {}).get("message")
        except (ValueError, AttributeError):
            message = None
        raise RuntimeError(f"BI ölçü isteği reddedildi (HTTP {exc.code}): {message or exc.reason}") from exc
    if receipt.get("protocol") != "floem-metric/v1" or receipt.get("metricId") != metric_id:
        raise ValueError("BI farklı bir ölçü veya sözleşme sürümü döndürdü")
    return receipt
