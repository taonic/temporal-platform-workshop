import { lab1 } from './labs/lab1';
import { lab2 } from './labs/lab2';
import { lab3 } from './labs/lab3';
import { lab4 } from './labs/lab4';
import type { LabDef } from './types';

export const LABS: LabDef[] = [lab1, lab2, lab3, lab4];
export const LAB_NUMBERS = LABS.map((l) => l.number);

export function lab(n: number): LabDef | undefined {
  return LABS.find((l) => l.number === n);
}

/** How a step names a snippet: its path, or its id when it has no path. */
export function snippetKey(snippet: { path?: string; id?: string }): string {
  return snippet.path ?? snippet.id ?? '';
}
