/** Değişmez rapor anlık görüntüleri; işaretçi hareketi tek işlem olarak saklanır. */
export class DesignHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private transaction: { before: T; future: T[] } | null = null;
  constructor(public present: T, private limit = 75) {}
  get canUndo() { return this.transaction ? this.transaction.before !== this.present || this.past.length > 0 : this.past.length > 0; }
  get canRedo() { return this.future.length > 0 && !this.transaction; }
  begin() { if (!this.transaction) this.transaction = { before: this.present, future: this.future }; }
  update(next: T) {
    if (next === this.present) return;
    if (!this.transaction) { this.past.push(this.present); this.trim(); }
    this.present = next; this.future = [];
  }
  commit() {
    if (this.transaction && this.transaction.before !== this.present) { this.past.push(this.transaction.before); this.trim(); }
    this.transaction = null;
  }
  cancel(): T { if (this.transaction) { this.present = this.transaction.before; this.future = this.transaction.future; } this.transaction = null; return this.present; }
  undo(): T {
    this.commit();
    if (this.past.length) { this.future.push(this.present); this.present = this.past.pop()!; }
    return this.present;
  }
  redo(): T {
    this.commit();
    if (this.future.length) { this.past.push(this.present); this.trim(); this.present = this.future.pop()!; }
    return this.present;
  }
  reset(next: T) { this.present = next; this.past = []; this.future = []; this.transaction = null; }
  private trim() { if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit); }
}
