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

    it('CDN scripts têm versão pinada e SRI', () => {
        const CDN_TAG = /<script[\s\S]*?cdn\.jsdelivr\.net[\s\S]*?>/g;
        const cdnTags = html.match(CDN_TAG) ?? [];
        expect(cdnTags.length).toBeGreaterThan(0);
        for (const tag of cdnTags) {
            expect(tag).toMatch(/@\d+\.\d+\.\d+/);
            expect(tag).toContain('integrity="sha384-');
        }
    });

    it('não usa o CDN de desenvolvimento do Tailwind', () => {
        expect(html).not.toContain('cdn.tailwindcss.com');
    });
});
