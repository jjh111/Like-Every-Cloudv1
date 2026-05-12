"""
List the heaviest meshes in the active Rhino document, and group by
likely duplicate (same face count + vertex count + bounding-box size).

Run from Rhino:
  1. Command: _EditPythonScript
  2. File > Open... this script
  3. Click Run

Output goes to the Python editor's output panel.
"""
import scriptcontext as sc
import Rhino
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
            "layer": doc.Layers[obj.Attributes.LayerIndex].FullPath,
            "name": obj.Name or "",
            "diag": round(bb.Diagonal.Length, 1),
            "center": (int(bb.Center.X), int(bb.Center.Y), int(bb.Center.Z)),
        })

if not meshes:
    print("No meshes in document.")
else:
    total_faces = sum(m["faces"] for m in meshes)
    meshes.sort(key=lambda m: m["faces"], reverse=True)

    print("=" * 78)
    print("{} mesh objects   |   {:,} faces total".format(len(meshes), total_faces))
    print("=" * 78)

    print("\nTOP 30 HEAVIEST MESHES\n")
    print("{:>10}  {:>10}  {:>10}  position                       name / id".format('faces', 'verts', 'diag'))
    for m in meshes[:30]:
        pos = "[{}, {}, {}]".format(*m['center'])
        label = m['name'] if m['name'] else m['id']
        print("{:>10,}  {:>10,}  {:>10.1f}  {:<30}  {}".format(
            m['faces'], m['verts'], m['diag'], pos, label))

    groups = defaultdict(list)
    for m in meshes:
        key = (m["faces"], m["verts"], m["diag"])
        groups[key].append(m)

    dupes = [(k, v) for k, v in groups.items() if len(v) > 1]
    dupes.sort(key=lambda kv: kv[0][0] * len(kv[1]), reverse=True)

    if dupes:
        print("\nLIKELY DUPLICATE GROUPS  ({} groups)\n".format(len(dupes)))
        for (faces, verts, diag), grp in dupes:
            wasted = faces * (len(grp) - 1)
            print("  {}x mesh ({:,}f / {:,}v / diag {}mm) - {:,} faces could be saved by blocking".format(len(grp), faces, verts, diag, wasted))
            for m in grp:
                pos = "[{}, {}, {}]".format(*m['center'])
                line = "    pos={:<30}  id={}".format(pos, m['id'])
                if m['name']:
                    line += "  name={}".format(m['name'])
                print(line)
    else:
        print("\nNo obvious duplicates by face/vertex/bbox match.")
