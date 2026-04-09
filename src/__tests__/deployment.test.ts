/**
 * deployment.test.ts — Render deployment readiness checklist.
 *
 * These tests verify the project is structurally ready to deploy on Render
 * as a static site.  They run against the actual files on disk, not mocks.
 *
 * Tests are grouped by concern:
 *   1. Build output integrity   — dist/ has all required files
 *   2. render.yaml correctness  — deployment config is valid
 *   3. No server-side deps      — client code never imports Node.js built-ins
 *   4. Security                 — no secrets or .env files committed
 *   5. Routing                  — SPA fallback is configured
 */

import { describe, it, expect } from 'vitest';
import fs   from 'fs';
import path from 'path';

const ROOT  = path.resolve(__dirname, '../..');  // voice-transcriber/
const SRC   = path.join(ROOT, 'src');
const DIST  = path.join(ROOT, 'dist');

// ── 1. Build output integrity ────────────────────────────────────────────────

describe('Build output — dist/ directory', () => {
  it('dist/ directory exists (npm run build has been run)', () => {
    expect(fs.existsSync(DIST)).toBe(true);
  });

  it('dist/index.html exists', () => {
    expect(fs.existsSync(path.join(DIST, 'index.html'))).toBe(true);
  });

  it('dist/assets/ directory exists (JS/CSS chunks)', () => {
    expect(fs.existsSync(path.join(DIST, 'assets'))).toBe(true);
  });

  it('dist/assets contains at least one JS file', () => {
    const assets = fs.readdirSync(path.join(DIST, 'assets'));
    expect(assets.some(f => f.endsWith('.js'))).toBe(true);
  });

  it('dist/index.html references /assets/ for scripts (Vite asset hashing)', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
    expect(html).toMatch(/\/assets\//);
  });

  it('dist/index.html has a <div id="root"> mount point', () => {
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
    expect(html).toContain('id="root"');
  });

  it('no source maps in dist (sourcemap: false in vite.config)', () => {
    const assets = fs.readdirSync(path.join(DIST, 'assets'));
    expect(assets.some(f => f.endsWith('.map'))).toBe(false);
  });
});

// ── 2. render.yaml correctness ───────────────────────────────────────────────

describe('render.yaml — deployment config', () => {
  const yamlPath = path.join(ROOT, 'render.yaml');
  let yaml = '';

  it('render.yaml exists in project root', () => {
    expect(fs.existsSync(yamlPath)).toBe(true);
    yaml = fs.readFileSync(yamlPath, 'utf-8');
  });

  it('specifies type: web with env: static', () => {
    yaml = yaml || fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toMatch(/type:\s*web/);
    expect(yaml).toMatch(/env:\s*static/);
  });

  it('sets staticPublishPath to dist', () => {
    yaml = yaml || fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toMatch(/staticPublishPath:\s*dist/);
  });

  it('includes build command with npm install && npm run build', () => {
    yaml = yaml || fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toMatch(/npm install/);
    expect(yaml).toMatch(/npm run build/);
  });

  it('SPA catch-all rewrite /* → /index.html is configured', () => {
    yaml = yaml || fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toMatch(/source:\s*\/\*/);
    expect(yaml).toMatch(/destination:\s*\/index\.html/);
  });

  it('includes security headers', () => {
    yaml = yaml || fs.readFileSync(yamlPath, 'utf-8');
    expect(yaml).toMatch(/X-Frame-Options/);
    expect(yaml).toMatch(/X-Content-Type-Options/);
  });
});

// ── 3. No server-side Node.js imports in client code ────────────────────────

describe('Client code — no server-side dependencies', () => {
  // These Node.js built-ins must NEVER appear in client source files
  const SERVER_ONLY_IMPORTS = ["from 'fs'", "from 'path'", "from 'http'", "require('fs')", "require('path')"];

  function scanSrcFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
        results.push(...scanSrcFiles(full));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  const srcFiles = scanSrcFiles(SRC);

  it('src/ contains TypeScript source files', () => {
    expect(srcFiles.length).toBeGreaterThan(0);
  });

  SERVER_ONLY_IMPORTS.forEach(importStr => {
    it(`no file imports "${importStr}" (server-only Node.js built-in)`, () => {
      const violators = srcFiles.filter(f => {
        const content = fs.readFileSync(f, 'utf-8');
        return content.includes(importStr);
      });
      expect(violators).toEqual([]);
    });
  });
});

// ── 4. Security — no secrets committed ──────────────────────────────────────

describe('Security — no secrets in repository', () => {
  it('.env file does NOT exist in project root', () => {
    expect(fs.existsSync(path.join(ROOT, '.env'))).toBe(false);
  });

  it('.env.local file does NOT exist in project root', () => {
    expect(fs.existsSync(path.join(ROOT, '.env.local'))).toBe(false);
  });

  it('package.json does not contain a hardcoded API key (AIza prefix)', () => {
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8');
    expect(pkg).not.toMatch(/AIza[A-Za-z0-9_-]{10,}/);
  });
});

// ── 5. Project structure completeness ────────────────────────────────────────

describe('Project structure — all required files present', () => {
  const REQUIRED_FILES = [
    'package.json',
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
    'render.yaml',
    'src/main.tsx',
    'src/App.tsx',
    'src/types.ts',
    'src/services/config.ts',
    'src/services/transcription/index.ts',
    'src/services/transcription/gemini.ts',
    'src/hooks/useAudioRecorder.ts',
    'src/components/ApiKeySetup.tsx',
    'src/components/AudioInput.tsx',
    'src/components/ProcessingState.tsx',
    'src/components/TranscriptView.tsx',
    'src/components/SettingsPanel.tsx',
  ];

  REQUIRED_FILES.forEach(file => {
    it(`${file} exists`, () => {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    });
  });
});

// ── 6. package.json sanity ────────────────────────────────────────────────────

describe('package.json — deployment scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  it('has "build" script', () => {
    expect(pkg.scripts?.build).toBeTruthy();
  });

  it('build script calls vite build', () => {
    expect(pkg.scripts.build).toContain('vite build');
  });

  it('does NOT have a "start" script that starts a Node server', () => {
    // This is a static site — a "start" script would imply a backend
    const startScript = pkg.scripts?.start ?? '';
    expect(startScript).not.toMatch(/node\s+server/i);
    expect(startScript).not.toMatch(/express/i);
  });

  it('@google/genai is in dependencies (needed in dist bundle)', () => {
    expect(pkg.dependencies?.['@google/genai']).toBeTruthy();
  });

  it('no express, multer, or sql.js in dependencies (no backend)', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['express']).toBeUndefined();
    expect(deps['multer']).toBeUndefined();
    expect(deps['sql.js']).toBeUndefined();
    expect(deps['better-sqlite3']).toBeUndefined();
  });
});
