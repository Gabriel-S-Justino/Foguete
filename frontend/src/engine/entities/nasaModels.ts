/**
 * Modelos 3D de naves reais do repositório oficial NASA 3D Resources (github.com/nasa/NASA-3D-Resources).
 * São usados só como representação visual de referência (sondas reais equivalentes a cada missão): a sonda
 * montada pelo jogador e os lançadores continuam procedurais, porque dependem da configuração e das animações.
 *
 * Os arquivos foram descompactados (Draco), simplificados e quantizados para o navegador; origem, licença e
 * processamento em docs/model-sources.md. Carregamento sob demanda: se falhar, a cena segue sem o modelo.
 */
import { PBRMaterial, type Scene, SceneLoader, TransformNode, Vector3 } from '@babylonjs/core';
import type { MissionId } from '../../types/catalog';

export type NasaModelId = 'landsat-8' | 'lro' | 'juno';

export interface NasaModelInfo {
  file: string;
  title: string;
  /** Página do modelo no repositório da NASA. */
  source: string;
  /** Maior dimensão do modelo exposto (m), em escala de exposição. */
  displaySize: number;
  note: string;
}

export const NASA_MODELS: Record<NasaModelId, NasaModelInfo> = {
  'landsat-8': {
    file: 'landsat8.glb',
    title: 'Landsat 8 (LDCM)',
    source: 'https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Landsat%208',
    displaySize: 5.5,
    note: 'Satélite de observação da Terra em órbita heliossíncrona a 705 km (NASA/USGS).',
  },
  lro: {
    file: 'lro.glb',
    title: 'Lunar Reconnaissance Orbiter (LRO)',
    source: 'https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Lunar%20Reconnaissance%20Orbiter%20(A)',
    displaySize: 5,
    note: 'Orbitador lunar da NASA em órbita polar baixa desde 2009.',
  },
  juno: {
    file: 'juno.glb',
    title: 'Juno',
    source: 'https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Juno%20(B)',
    displaySize: 6.5,
    note: 'Sonda da NASA em órbita polar de Júpiter desde 2016, movida a energia solar.',
  },
};

/** Nave real de referência para cada missão do jogo. */
export const REFERENCE_SPACECRAFT: Record<MissionId, NasaModelId> = {
  'leo-climate': 'landsat-8',
  'lunar-he3': 'lro',
  'jupiter-system': 'juno',
};

const METALLIC = /gold|bronze|silver|foil|mli|thermal/i;

/**
 * Carrega um modelo da NASA como filho de um nó novo, centrado na origem e com a maior dimensão igual a
 * `size` (m). Devolve null se o arquivo não puder ser carregado.
 */
export async function loadNasaModel(scene: Scene, id: NasaModelId, size = NASA_MODELS[id].displaySize): Promise<TransformNode | null> {
  const info = NASA_MODELS[id];
  const root = new TransformNode(`nasa-${id}`, scene);
  try {
    // Carregador glTF importado sob demanda (fica fora do pacote principal)
    await import('@babylonjs/loaders/glTF');
    const res = await SceneLoader.ImportMeshAsync('', `${import.meta.env.BASE_URL}models/nasa/`, info.file, scene);
    if (scene.isDisposed) return null;
    for (const m of res.meshes) if (!m.parent) m.parent = root;
    // Mantas térmicas e folhas metálicas refletem o ambiente (os materiais originais são foscos)
    for (const m of res.meshes) {
      const mat = m.material;
      if (mat instanceof PBRMaterial && METALLIC.test(mat.name)) { mat.metallic = 0.75; mat.roughness = 0.38; }
    }
    root.computeWorldMatrix(true);
    const { min, max } = root.getHierarchyBoundingVectors(true);
    const ext = max.subtract(min);
    const k = size / Math.max(ext.x, ext.y, ext.z, 1e-6);
    root.scaling.setAll(k);
    const c = min.add(max).scale(0.5);
    for (const child of root.getChildren()) (child as TransformNode).position.subtractInPlace(new Vector3(c.x, c.y, c.z));
    return root;
  } catch (e) {
    console.warn(`modelo da NASA "${info.file}" não carregado: ${(e as Error).message}`);
    root.dispose();
    return null;
  }
}
