"""
Find duplicate meshes and pre-select all-but-the-first copy of each group.

After running:
  - One mesh per duplicate group remains unselected (the "canonical" you keep)
  - All other copies in each group are selected, ready to Delete

Duplicate detection matches on face count + vertex count + bounding-box
diagonal (rounded to 0.1mm). Same fingerprint as find_heavy_meshes.py.

This catches translated copies of the same scan (most common case). It will
miss copies that have been non-uniformly scaled or rotated to non-axis-aligned
orientations, because their world-space bounding-box diagonal differs.
"""
import scriptcontext as sc
import Rhino
import rhinoscriptsyntax as rs
from collections import defaultdict

doc = sc.doc

meshes = []
for obj in doc.Objects:
    g = obj.Geometry
    if isinstance(g, Rhino.Geometry.Mesh):
        bb = g.GetBoundingBox(True)
        meshes.append({
            "id": str(obj.Id),
            "faces": g.Faces.Count,
            "verts": g.Vertices.Count,
            "diag": round(bb.Diagonal.Length, 1),
            "center": (int(bb.Center.X), int(bb.Center.Y), int(bb.Center.Z)),
        })

groups = defaultdict(list)
for m in meshes:
    key = (m["faces"], m["verts"], m["diag"])
    groups[key].append(m)

dupes = [(k, v) for k, v in groups.items() if len(v) > 1]
dupes.sort(key=lambda kv: kv[0][0] * (len(kv[1]) - 1), reverse=True)

if not dupes:
    print("No duplicate groups found.")
else:
    rs.UnselectAllObjects()
    total_extras = 0
    total_saved = 0

    print("DUPLICATE GROUPS  (canonical kept; extras selected for deletion)\n")
    for (faces, verts, diag), grp in dupes:
        keep = grp[0]
        extras = grp[1:]
        saved = faces * len(extras)
        total_extras += len(extras)
        total_saved += saved

        print("  {}x mesh ({:,}f / diag {}mm)  -  deleting {} extras saves {:,} faces".format(
            len(grp), faces, diag, len(extras), saved))
        print("    KEEP   pos={}".format(keep["center"]))
        for m in extras:
            rs.SelectObject(m["id"])
            print("    DELETE pos={}  id={}".format(m["center"], m["id"]))
        print("")

    sc.doc.Views.Redraw()
    print("=" * 72)
    print("Selected {} extras across {} groups.".format(total_extras, len(dupes)))
    print("Hit Delete to save {:,} faces.".format(total_saved))
