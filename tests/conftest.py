import sys
import types

if "folder_paths" not in sys.modules:
    import os

    m = types.ModuleType("folder_paths")
    m.get_input_directory = lambda: "."
    m.get_output_directory = lambda: "."
    m.get_temp_directory = lambda: "."
    m.get_annotated_filepath = lambda p: p

    def is_within_directory(directory, target):
        try:
            directory = os.path.realpath(directory)
            target = os.path.realpath(target)
            return os.path.commonpath((directory, target)) == directory
        except ValueError:
            return False

    m.is_within_directory = is_within_directory
    sys.modules["folder_paths"] = m
