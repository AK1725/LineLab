import { Group, Matrix4, Mesh, type BufferGeometry, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Collapses a model into one mesh per material (same look, far fewer draw calls). Used by the
 * assembly editor, where dozens of parts are on screen at once.
 */
export function mergeByMaterial(model: Group): Group {
  model.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(model.matrixWorld).invert();
  const buckets = new Map<Material, BufferGeometry[]>();
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = o.material as Material;
    const g = (o.geometry as BufferGeometry).clone();
    // Merging needs identical attribute sets: keep position + normal only.
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    const local = g.index ? g.toNonIndexed() : g;
    local.applyMatrix4(new Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    const list = buckets.get(mat) ?? [];
    list.push(local);
    buckets.set(mat, list);
  });
  const out = new Group();
  out.name = model.name;
  out.userData = { ...model.userData };
  for (const [mat, geoms] of buckets) {
    // Typed as non-null, but returns null when attributes differ.
    const merged = mergeGeometries(geoms, false) as BufferGeometry | null;
    for (const g of geoms) g.dispose();
    if (merged === null) continue;
    const mesh = new Mesh(merged, mat);
    mesh.name = "merged";
    out.add(mesh);
  }
  return out;
}
