    # True-faceted cut-crystal highball — Three.js / Claude Code asset

    This rebuild does **not** use a noisy radial height field. Every decorative cut is an explicit recessed V-cut with six planar triangles, a deep central valley ridge, duplicated hard-edge vertices, and flat facet normals. The smooth glass body and the cut facets are separate glTF primitives/materials so Three.js cannot accidentally smooth the corners away.

    ## Files

    - `true_faceted_crystal_highball_web.glb` — primary website model.
    - `true_faceted_crystal_highball_high.glb` — denser smooth-body tessellation for close hero shots.
    - `true_faceted_crystal_highball_with_whiskey.glb` — web model with separate liquid geometry.
    - `true_faceted_crystal_highball_web.gltf` + `.bin` — editable web glTF.
    - `true_faceted_crystal_highball.obj` + `.mtl` — fallback; MTL cannot match GLB transmission.
    - `materials/threejs-materials.js` — body, hard-facet and whiskey materials.
    - `materials/materials.json` — renderer-neutral values.
    - `load-in-threejs.js` — Claude Code / Three.js loading example.
    - `cut-layout-preview.png` — one repeated panel shown flat.

    ## Important

    Do not merge vertices, call `geometry.computeVertexNormals()` on the facet primitive, or run a smooth-normal modifier. Those actions erase the intentionally sharp crystal cuts. Use an HDR environment and reflection cards; transparent glass against empty white space will appear nearly invisible.

    ## Dimensions

    - Height: 160 mm
    - Rim diameter: 68.4 mm
    - Heavy base/cavity start: 12.5 mm
    - Units: meters
    - Orientation: Y-up in glTF / Three.js

    ## Statistics

    {
  "height_m": 0.16,
  "rim_diameter_m": 0.0684,
  "panels": 8,
  "cut_count_total": 136,
  "web_body_triangles": 5024,
  "web_facet_triangles": 816,
  "web_core_triangles": 32640,
  "high_body_triangles": 13712,
  "web_glb_bytes": 1502640,
  "high_glb_bytes": 3586996
}
