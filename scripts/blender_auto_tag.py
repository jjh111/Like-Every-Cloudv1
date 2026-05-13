"""
Auto-set Custom Properties on objects based on the collection they live in.

Rules:
- Objects in `*_Heroes` collections get:
    state         = "past" | "present" | "both"
    interactive   = True
    hero_id       = derived from object name (unless already set by user)
- Objects in `*_Shell`, `*_Exterior`, `*_Props` collections get:
    state         = "past" | "present" | "both"
    interactive   = False
- Objects in collections not listed below are skipped (sorted manually later).

Cassettes specifically need two extra Custom Properties (track_id,
audio_source_hero_id) — that's still a per-object call. This script
won't touch those.

Run in Blender's Text Editor or via the MCP. Safe to re-run after
moving objects around; sets are idempotent.
"""
import bpy
import re

COLLECTION_RULES = {
    "SHARED_Heroes":   {"state": "both",    "interactive": True},
    "SHARED_Shell":    {"state": "both",    "interactive": False},
    "SHARED_Exterior": {"state": "both",    "interactive": False},
    "SHARED_Props":    {"state": "both",    "interactive": False},
    "PAST_Heroes":     {"state": "past",    "interactive": True},
    "PAST_Props":      {"state": "past",    "interactive": False},
    "PRESENT_Heroes":  {"state": "present", "interactive": True},
    "PRESENT_Props":   {"state": "present", "interactive": False},
}


def normalize_hero_id(name):
    """Object name → snake_case, hero_-prefixed unless it already is."""
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    if not s.startswith("hero_"):
        s = "hero_" + s
    return s


def auto_tag(verbose=False):
    tagged = []
    skipped = []
    for obj in bpy.data.objects:
        matched_rule = None
        matched_col = None
        for col in obj.users_collection:
            rule = COLLECTION_RULES.get(col.name)
            if rule is not None:
                matched_rule = rule
                matched_col = col.name
                break
        if matched_rule is None:
            skipped.append(obj.name)
            continue
        obj["state"] = matched_rule["state"]
        obj["interactive"] = matched_rule["interactive"]
        if matched_rule["interactive"]:
            if "hero_id" not in obj or not obj["hero_id"]:
                obj["hero_id"] = normalize_hero_id(obj.name)
        tagged.append({
            "name": obj.name,
            "collection": matched_col,
            "state": obj["state"],
            "interactive": obj["interactive"],
            "hero_id": obj.get("hero_id"),
        })
    return {
        "tagged_count": len(tagged),
        "skipped_count": len(skipped),
        "tagged": tagged if verbose else None,
    }


if __name__ == "__main__":
    print(auto_tag(verbose=True))
