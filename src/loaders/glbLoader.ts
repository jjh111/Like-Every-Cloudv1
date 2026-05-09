import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export class GLBLoader {
  private loader: GLTFLoader;

  constructor() {
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
