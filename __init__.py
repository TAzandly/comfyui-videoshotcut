try:
    from .nodes.video_shotcut import VideoShotCut
    from .server.routes import register_routes
except ImportError:
    # Pytest may import this file without package context; ComfyUI loads it as a package.
    VideoShotCut = None
    register_routes = None

NODE_CLASS_MAPPINGS = {"VideoShotCut": VideoShotCut} if VideoShotCut is not None else {}
NODE_DISPLAY_NAME_MAPPINGS = {"VideoShotCut": "Video Shot Cut"} if VideoShotCut is not None else {}
WEB_DIRECTORY = "./js"

if register_routes is not None:
    try:
        register_routes()
    except Exception as e:
        import logging
        logging.warning("videoshotcut: failed to register routes: %s", e)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
