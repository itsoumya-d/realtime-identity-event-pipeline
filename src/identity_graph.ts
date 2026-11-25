import { Identifier } from './types.js';

export class IdentityGraph {
  // parent pointer for disjoint-set union (key -> parent_key)
  private parent: Map<string, string> = new Map();
  // canonical profile ID for a cluster root
  private clusterProfile: Map<string, string> = new Map();
  private nextProfileIndex: number = 1;

  public static formatKey(id: Identifier): string {
    return `${id.type.toUpperCase()}:${id.value.trim().toLowerCase()}`;
  }

  public find(key: string): string {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      return key;
    }
    const p = this.parent.get(key)!;
    if (p !== key) {
      const root = this.find(p);
      this.parent.set(key, root); // Path compression
      return root;
    }
    return p;
  }

  public union(keyA: string, keyB: string): string {
    const rootA = this.find(keyA);
    const rootB = this.find(keyB);
    if (rootA === rootB) return rootA;

    // Attach rootB to rootA
    this.parent.set(rootB, rootA);

    // Merge profile ID mapping - keep the oldest profile ID
    const profA = this.clusterProfile.get(rootA);
    const profB = this.clusterProfile.get(rootB);

    let resolvedProfile: string;
    if (profA && profB) {
      resolvedProfile = profA < profB ? profA : profB;
    } else {
      resolvedProfile = profA || profB || this.generateProfileId();
    }

    this.clusterProfile.set(rootA, resolvedProfile);
    this.clusterProfile.delete(rootB);

    return rootA;
  }

  private generateProfileId(): string {
    const id = `prof_${this.nextProfileIndex.toString().padStart(6, '0')}`;
    this.nextProfileIndex += 1;
    return id;
  }

  public resolveIdentifiers(identifiers: Identifier[]): string {
    if (identifiers.length === 0) {
      throw new Error('At least one identifier required for resolution');
    }

    const keys = identifiers.map(IdentityGraph.formatKey);
    let existingProfile: string | null = null;

    // Check if any identifier already has an existing profile
    for (const k of keys) {
      const r = this.find(k);
      const prof = this.clusterProfile.get(r);
      if (prof) {
        if (!existingProfile || prof < existingProfile) {
          existingProfile = prof;
        }
      }
    }

    const targetProfile = existingProfile || this.generateProfileId();

    let root = this.find(keys[0]);
    for (let i = 1; i < keys.length; i++) {
      root = this.union(root, keys[i]);
    }

    this.clusterProfile.set(root, targetProfile);
    return targetProfile;
  }

  public getProfileId(id: Identifier): string | null {
    const key = IdentityGraph.formatKey(id);
    if (!this.parent.has(key)) return null;
    const root = this.find(key);
    return this.clusterProfile.get(root) || null;
  }
}
