/**
 * How many brains may start thinking at once, across the cast. A character
 * holds no reservation while waiting here, so everything that arrives in the
 * meantime joins the one turn built when their slot opens.
 */
export class BrainSlots {
  private readonly held = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly waiting = new Map<string, () => void>();

  /** True if they hold a slot now. Otherwise `onGrant` runs when one opens. */
  acquire(agentId: string, limit: number, onGrant: () => void): boolean {
    if (this.held.has(agentId)) return true;
    if (this.held.size < limit && !this.waiting.size) {
      this.held.add(agentId);
      return true;
    }
    // A re-request keeps their place in line.
    this.waiting.set(agentId, onGrant);
    return false;
  }

  /** Their slot now belongs to a dispatch, which gives it back when done. */
  dispatch(agentId: string): void {
    if (this.held.has(agentId)) this.dispatching.add(agentId);
  }

  isDispatching(agentId: string): boolean {
    return this.dispatching.has(agentId);
  }

  release(agentId: string, limit: number): void {
    this.held.delete(agentId);
    this.dispatching.delete(agentId);
    for (const [next, onGrant] of this.waiting) {
      if (this.held.size >= limit) return;
      this.waiting.delete(next);
      this.held.add(next);
      onGrant();
    }
  }
}
