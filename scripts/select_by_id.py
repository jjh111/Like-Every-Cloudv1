"""
Select Rhino objects by GUID.

Usage:
  1. Run find_heavy_meshes.py first to print object GUIDs.
  2. Paste the relevant lines (or just the bare GUIDs) into the IDS string
     between the triple quotes below. The script extracts GUIDs via regex,
     so you can paste whole output lines verbatim, e.g.:
        pos=[12300, 4500, 0]   id=3fa85f64-5717-4562-b3fc-2c963f66afa6
  3. Run this script. Matching objects get selected in the viewport.
"""
import re
import scriptcontext as sc
import rhinoscriptsyntax as rs

IDS = """
"""

GUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)

ids = GUID_RE.findall(IDS)

if not ids:
    print("No GUIDs found in IDS. Paste lines from find_heavy_meshes.py output between the triple quotes at the top of this script.")
else:
    rs.UnselectAllObjects()
    found = 0
    missing = []
    for s in ids:
        if rs.SelectObject(s):
            found += 1
        else:
            missing.append(s)
    sc.doc.Views.Redraw()
    print("Selected {} of {} object(s).".format(found, len(ids)))
    if missing:
        print("\nNot found in document:")
        for s in missing:
            print("  {}".format(s))
