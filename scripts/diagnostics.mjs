/**
 * Runs the real TypeScript compiler over the snippets the landing page quotes, and writes
 * the verbatim diagnostics into docs/diagnostics.js.
 *
 * The page's central claim is that a rule which does not fit its field does not compile. The
 * honest way to show that is not to type a plausible-looking error into the HTML — it is to
 * compile the snippet and print whatever the compiler said. If a snippet marked `rejected`
 * ever starts compiling, or a snippet marked `compiles` stops, the build fails here rather
 * than the page quietly going on claiming something that is no longer true.
 */
import ts from 'typescript';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Each case is compiled against the real library, not a stub. */
export const CASES = [
  {
    id: 'hero',
    expect: 'rejected',
    // Kept character-for-character in step with the hero block in docs/index.html.
    source: `import { JsonProperty, IsString, Matches, IsInt, Min, fromJsonSync } from '../src/index.js';
declare const body: string;

class Order {
  @JsonProperty('order_ref')
  @IsString() @Matches(/^[A-Z]-\\d+$/)
  ref!: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsString()
  placedAt!: Date;

  total(): number { return this.quantity * 9.99; }
}

const order = fromJsonSync(Order, body);
order.total();
`,
  },
  {
    id: 'compare',
    expect: 'rejected',
    source: `import { IsString } from '../src/index.js';

export class User {
  @IsString()
  age!: number;
}
`,
  },
  {
    id: 'instances',
    expect: 'compiles',
    // The "What you get back" section. It is here because an earlier draft showed
    // `list.items[0].hours()` on a `Media[]`, which tsc rejects with TS2339 — TypeScript that
    // the compiler refuses, on a page whose whole argument is that the compiler is the authority.
    source: `import { IsString, IsInt, Min, JsonPolymorphic, ValidateNested, fromJsonSync } from '../src/index.js';
declare const body: string;

class Media {
  @IsString() title!: string;
}
class Movie extends Media {
  @IsInt() @Min(1) duration!: number;
  hours() { return this.duration / 60; }
}
class Song extends Media {
  @IsString() artist!: string;
}

class Playlist {
  @JsonPolymorphic<Media>('type', [
    { value: Movie, name: 'movie' },
    { value: Song,  name: 'song'  },
  ])
  @ValidateNested({ each: true })
  items!: Media[];
}

const list = fromJsonSync(Playlist, body);
const first = list.items[0];

first instanceof Movie;

if (first instanceof Movie) {
  first.hours();
}
`,
  },
  {
    id: 'correct',
    expect: 'compiles',
    // The same class with the rule that actually fits, so a broken harness cannot make the
    // two cases above "pass" by failing everything.
    source: `import { JsonProperty, IsString, Matches, IsInt, Min, IsDate, fromJsonSync } from '../src/index.js';
declare const body: string;

class Order {
  @JsonProperty('order_ref')
  @IsString() @Matches(/^[A-Z]-\\d+$/)
  ref!: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsDate()
  placedAt!: Date;

  total(): number { return this.quantity * 9.99; }
}

const order = fromJsonSync(Order, body);
order.total();
`,
  },
];

/** Compiles every case in one program and returns its diagnostics, keyed by case id. */
export async function collectDiagnostics(root) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cereale-diagnostics-'));
  try {
    const files = new Map();
    for (const testCase of CASES) {
      const file = path.join(dir, `${testCase.id}.ts`);
      // The snippets import '../src/index.js' relative to a sibling of src/, so they are
      // written one directory below the repo root.
      const target = path.join(root, '.diagnostics', `${testCase.id}.ts`);
      files.set(testCase.id, target);
      await writeFile(file, testCase.source);
    }

    // Write into the repo so that '../src/index.js' resolves the way it does for a consumer.
    const scratch = path.join(root, '.diagnostics');
    await rm(scratch, { recursive: true, force: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(scratch, { recursive: true });
    for (const testCase of CASES) {
      await writeFile(files.get(testCase.id), testCase.source);
    }

    const configPath = path.join(root, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);

    const program = ts.createProgram([...files.values()], {
      ...parsed.options,
      noEmit: true,
      rootDir: root,
      outDir: undefined,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
    });

    const all = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
    const byCase = {};
    const problems = [];

    for (const testCase of CASES) {
      const file = files.get(testCase.id);
      const mine = all.filter((d) => d.file && path.resolve(d.file.fileName) === path.resolve(file));

      if (testCase.expect === 'rejected' && mine.length === 0) {
        problems.push(`case "${testCase.id}" was expected to be rejected by tsc, but it compiled. ` +
          'The landing page claims this is a compile error — either the claim or the library is wrong.');
      }
      if (testCase.expect === 'compiles' && mine.length > 0) {
        problems.push(`case "${testCase.id}" was expected to compile, but tsc reported: ` +
          ts.flattenDiagnosticMessageText(mine[0].messageText, ' '));
      }

      byCase[testCase.id] = mine.map((diagnostic) => {
        const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        return {
          code: diagnostic.code,
          // The chain, flattened one message per level, so the page can show the headline
          // and the "Type X is not assignable to type Y" leaf without inventing either.
          messages: flattenChain(diagnostic.messageText),
          line: line + 1,
        };
      });
    }

    // Diagnostics anywhere else mean the harness itself is broken.
    const stray = all.filter((d) => !d.file || ![...files.values()].some((f) => path.resolve(d.file.fileName) === path.resolve(f)));
    if (stray.length > 0) {
      problems.push(`the diagnostics harness produced ${stray.length} error(s) outside the cases, ` +
        `starting with: ${ts.flattenDiagnosticMessageText(stray[0].messageText, ' ')}`);
    }

    await rm(scratch, { recursive: true, force: true });
    return { byCase, problems };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function flattenChain(messageText) {
  if (typeof messageText === 'string') return [messageText];
  const out = [];
  let node = messageText;
  while (node) {
    out.push(node.messageText);
    node = node.next && node.next[0];
  }
  return out;
}
