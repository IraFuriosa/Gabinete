import { describe, it, expect } from 'vitest';
import { escapeHtml } from './utils.js';

describe('escapeHtml', () => {
    it('escapes HTML metacharacters', () => {
        expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    });

    it('escapes ampersand first to avoid double-escaping', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes single quotes', () => {
        expect(escapeHtml("o'brien")).toBe('o&#39;brien');
    });

    it('returns empty string for null/undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('coerces numbers to string', () => {
        expect(escapeHtml(42)).toBe('42');
    });

    it('passes through safe text unchanged', () => {
        expect(escapeHtml('Demanda de energia')).toBe('Demanda de energia');
    });
});
