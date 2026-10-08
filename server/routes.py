from aiohttp import web
from server import PromptServer

from ..core.paths import resolve_safe_media_path
from ..core.media import probe_media
from ..core.frames import extract_frame_jpeg
from ..core.detect import scene_points, interval_points
from ..core.timeline import resolve_timeline


def _fps_override(val) -> float:
    try:
        return float(val or 0)
    except (TypeError, ValueError):
        return 0.0


def register_routes():
    routes = PromptServer.instance.routes

    @routes.get("/videoshotcut/info")
    async def info(request):
        try:
            q = request.rel_url.query
            path = resolve_safe_media_path(q.get("path", ""))
            raw = probe_media(path)
            tl = resolve_timeline(raw, _fps_override(q.get("fps")))
            return web.json_response(tl)
        except ValueError as e:
            return web.Response(status=400, text=str(e))
        except Exception as e:
            return web.Response(status=500, text=str(e) or "info failed")

    @routes.get("/videoshotcut/frame")
    async def frame(request):
        try:
            q = request.rel_url.query
            path = resolve_safe_media_path(q.get("path", ""))
            idx = int(q.get("frame_index", "0"))
            raw = probe_media(path)
            tl = resolve_timeline(raw, _fps_override(q.get("fps")))
            data = extract_frame_jpeg(
                path,
                idx,
                tl["fps"],
                source_fps=tl["source_fps"],
                source_total_frames=tl["source_total_frames"],
            )
            return web.Response(body=data, content_type="image/jpeg")
        except ValueError as e:
            return web.Response(status=400, text=str(e))
        except Exception as e:
            return web.Response(status=500, text=str(e) or "frame failed")

    @routes.post("/videoshotcut/detect/scenes")
    async def detect_scenes(request):
        try:
            body = await request.json()
            path = resolve_safe_media_path(body.get("path", ""))
            raw = probe_media(path)
            tl = resolve_timeline(raw, _fps_override(body.get("fps")))
            # Detect in source time, convert cut times to working-timeline frames
            src_pts = scene_points(
                path, tl["source_total_frames"] or tl["total_frames"],
                tl["source_fps"] or tl["fps"],
                body.get("sensitivity", "medium"),
            )
            if tl["source_fps"] > 0 and abs(tl["source_fps"] - tl["fps"]) > 1e-6:
                pts = sorted({
                    max(1, min(tl["total_frames"] - 1, int(round(p * tl["fps"] / tl["source_fps"]))))
                    for p in src_pts
                    if tl["total_frames"] > 1
                })
            else:
                pts = src_pts
            return web.json_response({
                "points": pts,
                "fps": tl["fps"],
                "total_frames": tl["total_frames"],
                "source_fps": tl["source_fps"],
            })
        except ValueError as e:
            return web.Response(status=400, text=str(e))
        except Exception as e:
            return web.Response(status=500, text=str(e) or "detect scenes failed")

    @routes.post("/videoshotcut/detect/interval")
    async def detect_interval(request):
        try:
            body = await request.json()
            path = resolve_safe_media_path(body.get("path", ""))
            raw = probe_media(path)
            tl = resolve_timeline(raw, _fps_override(body.get("fps")))
            pts = interval_points(
                tl["total_frames"], tl["fps"],
                float(body.get("interval_sec", 5)),
            )
            return web.json_response({
                "points": pts,
                "fps": tl["fps"],
                "total_frames": tl["total_frames"],
                "source_fps": tl["source_fps"],
            })
        except ValueError as e:
            return web.Response(status=400, text=str(e))
        except Exception as e:
            return web.Response(status=500, text=str(e) or "detect interval failed")
