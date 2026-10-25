/**
 * Grupos de renderização com profundidade limpa entre eles. Usado quando a cena mistura objetos de escalas
 * muito diferentes (ex.: a Terra em tamanho real, com milhares de km, e a plataforma, com detalhes de cm):
 * cada grupo usa o buffer de profundidade inteiro, então a Terra não disputa profundidade com o terreno.
 *
 * Atenção: o Babylon avisa `onNewMeshAddedObservable` de forma assíncrona (no próximo ciclo do navegador),
 * inclusive para malhas criadas antes de o observador ser registrado. Por isso o observador precisa
 * respeitar os grupos já atribuídos às malhas reservadas; sem isso a Terra e o céu voltavam para o grupo
 * local logo depois de a cena ser montada e o terreno "piscava" com a superfície da Terra.
 */
import type { AbstractMesh, Node, Observer, Scene } from '@babylonjs/core';

export interface GroupAssigner {
  /** Coloca uma malha (e as filhas) num grupo fixo, que o grupo padrão não sobrescreve. */
  reserve(mesh: AbstractMesh, group: number): void;
  /** Grupo de uma malha segundo as reservas (a reserva vale para as descendentes). */
  groupOf(mesh: AbstractMesh): number;
  dispose(): void;
}

export function createGroupAssigner(scene: Scene, defaultGroup: number): GroupAssigner {
  const reserved = new Map<Node, number>();
  const groupOf = (mesh: AbstractMesh): number => {
    for (let n: Node | null = mesh; n; n = n.parent) {
      const g = reserved.get(n);
      if (g !== undefined) return g;
    }
    return defaultGroup;
  };
  const apply = (mesh: AbstractMesh) => { mesh.renderingGroupId = groupOf(mesh); };
  for (const m of scene.meshes) apply(m);
  const obs: Observer<AbstractMesh> = scene.onNewMeshAddedObservable.add(apply);
  return {
    reserve(mesh, group) {
      reserved.set(mesh, group);
      mesh.renderingGroupId = group;
      for (const c of mesh.getChildMeshes()) c.renderingGroupId = group;
    },
    groupOf,
    dispose() { scene.onNewMeshAddedObservable.remove(obs); },
  };
}
