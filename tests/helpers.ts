import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDxf } from '../src/drawing/dxf';
import { flatten } from '../src/drawing/flatten';
import { decodeDxf } from '../src/drawing/text';
import type { Drawing2D } from '../src/drawing/types';

export function loadFixture(name: string): Drawing2D {
  const bytes = new Uint8Array(readFileSync(resolve(__dirname, 'fixtures', name)));
  const { text, encoding } = decodeDxf(bytes);
  const { doc, skipped } = parseDxf(text, encoding);
  return flatten(doc, 'dxf', skipped);
}
