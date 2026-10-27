#!/usr/bin/env node
/**
 * Writes src/ui/notices.json: every work by others that the app ships, with its licence text, for the
 * Licences page. The npm packages are read from the bundle's own source map, so only what ships is
 * listed. The networks, the native runtime and the Android libraries (from the release build's
 * classpath) are listed here by hand. Run after changing dependencies: `npm run notices`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8').trim();

const mit = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const apache = read('scripts/licences/Apache-2.0.txt');
const onnxVersion = read('modules/go-net/android/build.gradle').match(/onnxruntime-android:([\d.]+)/)[1];

const native = [
  {
    name: 'KataGo',
    note: 'The networks kata1-b10c128 and b18c384nbt-humanv0, and the network inputs and human-style profiles ported from its source.',
    licence: 'MIT',
    text: read('modules/go-net/android/src/main/assets/nets/LICENSE.txt'),
  },
  { name: 'ONNX Runtime', version: onnxVersion, licence: 'MIT', text: mit('Microsoft Corporation') },
  { name: 'Ionicons', licence: 'MIT', text: mit('2015-present Ionic (http://ionic.io/)') },
  { name: 'SQLite', licence: 'Public domain', text: 'The author disclaims copyright to this source code.' },
  { name: 'Hermes, Yoga, Fresco and Infer annotations', licence: 'MIT', text: mit('Meta Platforms, Inc. and affiliates.') },
  { name: 'Brotli', licence: 'MIT', text: mit('2009, 2010, 2013-2016 by the Brotli Authors.') },
  { name: 'Pika', licence: 'MIT', text: mit('the Pika authors') },
  {
    name: 'Bolts',
    licence: 'BSD-3-Clause',
    text: `BSD License

For Bolts software

Copyright (c) 2013-present, Facebook, Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

 * Neither the name Facebook nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
  ...[
    'AndroidX, Media3 and Material Components (The Android Open Source Project)',
    'Guava, Gson, Error Prone annotations and JSR 305 (Google)',
    'Kotlin and kotlinx (JetBrains)',
    'OkHttp, Okio and zstd-kmp (Square)',
    'SoLoader and fbjni (Meta)',
    'JSpecify and javax.inject',
  ].map((name) => ({ name, licence: 'Apache-2.0', text: apache })),
];

/** The npm packages whose code is in the bundle, each with the licence files in its folder. */
function bundled() {
  const out = mkdtempSync(join(tmpdir(), 'notices-'));
  execFileSync('npx', ['expo', 'export', '--platform', 'android', '--source-maps', '--output-dir', out], {
    cwd: root,
    stdio: 'ignore',
  });
  const dir = join(out, '_expo/static/js/android');
  const map = JSON.parse(
    readFileSync(
      join(
        dir,
        readdirSync(dir).find((f) => f.endsWith('.map')),
      ),
      'utf8',
    ),
  );
  const folders = new Map();
  for (const source of map.sources) {
    const at = source.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const parts = source.slice(at + 'node_modules/'.length).split('/');
    const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    folders.set(name, join(root, source.slice(0, at + 'node_modules/'.length), name));
  }
  const packages = [...folders].map(([name, folder]) => {
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const files = readdirSync(folder)
      .filter((f) => /^licen[cs]e/i.test(f))
      .sort();
    const text = files.map((f) => readFileSync(join(folder, f), 'utf8').trim()).join('\n\n');
    return { name, version: pkg.version, licence: pkg.license, text, repo: pkg.repository?.url ?? pkg.repository };
  });
  // A package published from a monorepo's subfolder may carry no licence file; the repository's own does.
  for (const p of packages.filter((p) => !p.text)) {
    p.text = packages.find((o) => o.text && o.repo === p.repo)?.text;
    if (!p.text) throw new Error(`${p.name} ships no licence file`);
  }
  for (const p of packages) delete p.repo;
  return packages;
}

const works = [...native, ...bundled().sort((a, b) => a.name.localeCompare(b.name))];
// Many works share one text, so each is stored once.
const texts = {};
for (const work of works) {
  const id = createHash('sha256').update(work.text).digest('hex').slice(0, 12);
  texts[id] = work.text;
  work.text = id;
}
writeFileSync(join(root, 'src/ui/notices.json'), `${JSON.stringify({ works, texts }, null, 1)}\n`);
console.log(`${works.length} works, ${Object.keys(texts).length} licence texts`);
