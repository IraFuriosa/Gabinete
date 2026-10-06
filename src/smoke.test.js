import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const mainJs = readFileSync(join(root, 'src', 'main.js'), 'utf8');

describe('smoke: integração HTML ↔ JS', () => {
    it('todo getElementById em main.js tem id correspondente em index.html', () => {
        const usedIds = new Set([...mainJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
        const missing = [...usedIds].filter((id) => !html.includes(`id="${id}"`));
        expect(missing).toEqual([]);
    });

    it('index.html referencia o entrypoint src/main.js', () => {
        expect(html).toContain('/src/main.js');
    });

    it('Chart.js e Supabase vêm do bundle npm, não de CDN', () => {
        expect(html).not.toContain('cdn.jsdelivr.net');
        expect(html).not.toContain('cdn.tailwindcss.com');
    });
});
