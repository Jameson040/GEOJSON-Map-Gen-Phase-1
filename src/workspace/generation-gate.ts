/**
 * The frozen generators contain module-level ID counters. Serialize jobs at
 * the workspace boundary instead of changing their established algorithms.
 */
export class GenerationGate {
  private token: symbol | null = null;
  private label = "";

  get activeJob(): string | null {
    return this.token ? this.label : null;
  }

  begin(label: string): (() => void) | null {
    if (this.token) return null;
    const token = Symbol(label);
    this.token = token;
    this.label = label;
    return () => {
      if (this.token !== token) return;
      this.token = null;
      this.label = "";
    };
  }
}