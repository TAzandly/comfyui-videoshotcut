import sys
import types

if "folder_paths" not in sys.modules:
    m = types.ModuleType("folder_paths")
    m.get_input_directory = lambda: "."
    m.get_output_directory = lambda: "."
    m.get_temp_directory = lambda: "."
    m.get_annotated_filepath = lambda p: p
    sys.modules["folder_paths"] = m
