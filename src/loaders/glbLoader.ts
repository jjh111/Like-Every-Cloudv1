import type { Object3D, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// GLB loader with Draco (mesh compression) + WebP textures (via EXT_texture_webp,
// handled natively by GLTFLoader — no extra setup needed). The compression
// pass that bakes these into the GLBs lives in `npm run compress`. If we
// later want GPU-native textures (KTX2 / Basis), re-add KTX2Loader here AND
// switch the compression script's --texture-compress to `ktx2`.
//
// Renderer arg is unused today but kept for forward-compat with KTX2Loader's
// detectSupport API.
export class GLBLoader {
  private loader: GLTFLoader;

  constructor(_renderer?: WebGLRenderer) {
    const draco = new DRACOLoader();
    // Hosted decoder for dev. Vendor locally before ship.
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
  }

  async load(url: string): Promise<Object3D> {
    const gltf = await this.loader.loadAsync(url);
    return gltf.scene;
  }
}
