import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfPage, PT_MM, type PdfOps } from '../src/drawing/pdf';

function makePdf(content: string): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('PDF 向量擷取', () => {
  it('線段依顏色分層、套用 cm 變換、文字位置', async () => {
    const content = [
      '1 0 0 RG 2 w 100 100 m 300 100 l S',
      '0 0 1 RG q 1 0 0 1 50 50 cm 0 0 m 0 100 l S Q',
      '0 g 400 300 50 40 re f',
      'BT /F1 12 Tf 100 200 Td (G1 H588x300) Tj ET',
    ].join('\n');
    const doc = await pdfjs.getDocument({ data: makePdf(content), isEvalSupported: false, useSystemFonts: false, verbosity: 0 } as any).promise;
    const page = await doc.getPage(1);
    const d = await extractPdfPage(page as any, pdfjs.OPS as unknown as PdfOps);
    const world = (name: string) => {
      const i = d.layers.findIndex((l) => l.name === name);
      expect(i, name).toBeGreaterThanOrEqual(0);
      const s = d.segs[i];
      const out: number[][] = [];
      for (let k = 0; k < s.length; k += 4) out.push([s[k] + d.base[0], s[k + 1] + d.base[1], s[k + 2] + d.base[0], s[k + 3] + d.base[1]]);
      return out;
    };
    expect(world('顏色 #ff0000')).toEqual([[100, 100, 300, 100]]);
    expect(world('顏色 #0000ff')).toEqual([[50, 50, 50, 150]]);
    expect(world('填色區塊').length).toBe(4);
    expect(d.layers.find((l) => l.name === '填色區塊')!.off).toBe(true);
    const t = d.texts.find((x) => x.s === 'G1 H588x300')!;
    expect(t.x + d.base[0]).toBeCloseTo(100);
    expect(t.y + d.base[1]).toBeCloseTo(200);
    expect(t.h).toBeCloseTo(12 * 0.72);
    expect(d.unitScale).toBeCloseTo(PT_MM);
    // 外框含整個頁面
    expect(d.bounds[2] - d.bounds[0]).toBeCloseTo(600);
  });
});
