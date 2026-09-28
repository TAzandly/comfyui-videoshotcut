import os
import folder_paths


def get_allowed_roots() -> list[str]:
    return [
        os.path.abspath(folder_paths.get_input_directory()),
        os.path.abspath(folder_paths.get_output_directory()),
        os.path.abspath(folder_paths.get_temp_directory()),
    ]


def resolve_safe_media_path(path: str) -> str:
    if not path:
        raise ValueError("Empty media path")
    if not os.path.isabs(path) and hasattr(folder_paths, "get_annotated_filepath"):
        try:
            path = folder_paths.get_annotated_filepath(path)
        except Exception:
            path = os.path.join(folder_paths.get_input_directory(), path)
    abspath = os.path.abspath(path)
    if not os.path.isfile(abspath):
        raise ValueError(f"Media file not found: {path}")
    for root in get_allowed_roots():
        try:
            if os.path.commonpath([root, abspath]) == root:
                return abspath
        except ValueError:
            continue
    raise ValueError(f"Path not allowed: {path}")
