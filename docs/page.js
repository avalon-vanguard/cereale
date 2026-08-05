/* cereale landing page. No dependencies, no network. */
(function () {
  'use strict';

  var meta = window.CEREALE_META || {};

  /* ------------------------------------------------------------- theme */
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem('cereale-theme'); } catch (e) { /* private mode */ }
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);

  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      if (!current) {
        current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('cereale-theme', next); } catch (e) { /* ignore */ }
    });
  }

  /* ------------------------------------------------------- facts on tap */
  // Read from the bundle rather than written into the page, so they cannot drift.
  var exportNames = Object.keys(window.Cereale || {}).filter(function (name) {
    return /^[A-Za-z_$][\w$]*$/.test(name);
  });
  var decoratorCount = exportNames.filter(function (name) {
    return /^[A-Z]/.test(name) && typeof window.Cereale[name] === 'function' &&
      !/^Json(Mapping|Validation)Error$|^JsonMapper$/.test(name);
  }).length;

  var countEl = document.getElementById('decorator-count');
  if (countEl && decoratorCount) countEl.textContent = String(decoratorCount);
  var versionEl = document.getElementById('version-badge');
  if (versionEl && meta.version) versionEl.textContent = 'v' + meta.version;
  var nodeEl = document.getElementById('node-req');
  if (nodeEl && meta.node) nodeEl.textContent = meta.node.replace('>=', '≥').replace('.0.0', '');

  /* ------------------------------------------------------- highlighting */
  var TOKENS = [
    ['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
    ['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/(?:[^\/\\\n\[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/],
    ['decorator', /@[A-Za-z_$][\w$]*/],
    ['keyword', /\b(?:class|extends|implements|interface|const|let|var|function|return|new|await|async|import|export|from|type|enum|if|else|for|of|in|try|catch|throw|instanceof|typeof|null|undefined|true|false|this|readonly|private|public|static|default)\b/],
    ['type', /\b(?:string|number|boolean|bigint|symbol|Date|any|unknown|void|never|Promise|Array|Map|Set|Error|TypeError|Record|Partial)\b/],
    ['number', /\b\d[\d_]*(?:\.\d+)?n?\b/]
  ];
  var TOKEN_RE = new RegExp(TOKENS.map(function (t) {
    return '(?<' + t[0] + '>' + t[1].source + ')';
  }).join('|'), 'g');

  function esc(text) {
    return text.replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function highlight(code) {
    var out = '', last = 0, match;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(code)) !== null) {
      out += esc(code.slice(last, match.index));
      var kind = '';
      for (var key in match.groups) {
        if (match.groups[key] !== undefined) { kind = key; break; }
      }
      out += '<span class="t-' + kind + '">' + esc(match[0]) + '</span>';
      last = match.index + match[0].length;
    }
    return out + esc(code.slice(last));
  }

  // Wraps each line so a single one can be marked as the line the compiler refuses.
  function renderCode(block) {
    var source = block.textContent.replace(/\n$/, '');
    var errorLine = parseInt(block.getAttribute('data-error-line') || '0', 10);
    var plain = block.getAttribute('data-lang') === 'text';
    var lines = (plain ? esc(source) : highlight(source)).split('\n');
    block.innerHTML = lines.map(function (line, index) {
      var cls = index + 1 === errorLine ? 'ln ln--error' : 'ln';
      return '<span class="' + cls + '">' + (line || '&nbsp;') + '</span>';
    }).join('');
  }

  Array.prototype.forEach.call(document.querySelectorAll('pre code[data-lang]'), renderCode);

  /* ------------------------------------------------- compiler diagnostics */
  // Written by scripts/build-docs.mjs from a real `tsc` run over the same snippet, so the
  // page cannot quote an error the compiler did not produce. Falls back to the markup.
  Array.prototype.forEach.call(document.querySelectorAll('[data-case]'), function (el) {
    var found = (window.CEREALE_DIAGNOSTICS || {})[el.getAttribute('data-case')];
    if (!found || !found.length) return;
    var diagnostic = found[0];
    var headline = diagnostic.messages[0];
    var leaf = diagnostic.messages[diagnostic.messages.length - 1];
    var body = '<strong>ts(' + diagnostic.code + ')</strong> ' + esc(headline);
    if (leaf !== headline) body += '<br>&nbsp;&nbsp;…&nbsp;&nbsp;' + esc(leaf);
    el.innerHTML = '<span class="mark" aria-hidden="true">✖</span><span>' + body + '</span>';
  });

  /* ---------------------------------------------------------- reference */
  var REFERENCE = [
    ['Mapping', 'How a field is named and shaped on the JSON side.', [
      ["@JsonProperty(name)", 'maps this field to a different name in JSON, both directions'],
      ["@JsonAlias(...names)", 'extra names accepted on input only'],
      ["@JsonType(() => Class)", 'declares the class a nested field maps to'],
      ["@JsonPolymorphic<Base>(key, subTypes, options?)", 'picks the concrete subclass from a discriminator'],
      ["@JsonSerialize(Serializer)", 'custom serializer for this field'],
      ["@JsonDeserialize(Deserializer)", 'custom deserializer for this field']
    ]],
    ['Access control', 'Which direction a field is allowed to travel.', [
      ["@JsonIgnore()", 'excluded from mapping in both directions'],
      ["@JsonReadOnly()", 'written to JSON, never populated from it — server-owned ids'],
      ["@JsonWriteOnly()", 'populated from JSON, never written back — passwords']
    ]],
    ['Control flow', 'When the rules on a field apply at all.', [
      ["@IsOptional()", 'skips the other rules when the value is null or undefined'],
      ["@ValidateIf(fn)", 'skips every rule when the predicate returns false'],
      ["@ValidateNested(options?)", 'recursively validates the value, or each element'],
      ["@Allow()", 'declares a field that carries no rules of its own']
    ]],
    ['Type rules', 'What kind of value the field holds.', [
      ["@IsString()", 'must be a string'],
      ["@IsNumber()", 'must be a number'],
      ["@IsInt()", 'must be an integer'],
      ["@IsBoolean()", 'must be a boolean'],
      ["@IsBigInt()", 'must be a bigint'],
      ["@IsDate()", 'must be a valid Date object'],
      ["@IsObject()", 'must be an object'],
      ["@IsDefined()", 'must not be null or undefined'],
      ["@IsNotEmpty()", 'must not be empty'],
      ["@IsEmpty()", 'must be empty']
    ]],
    ['Numbers', 'Constraints on number fields.', [
      ["@Min(n)", 'must be at least n'],
      ["@Max(n)", 'must be at most n'],
      ["@Positive()", 'must be positive'],
      ["@Negative()", 'must be negative'],
      ["@IsDivisibleBy(n)", 'must be divisible by n'],
      ["@IsPort()", 'must be a valid port number — attaches to a number or a numeric string'],
      ["@IsLatitude()", 'must be a latitude between −90 and 90'],
      ["@IsLongitude()", 'must be a longitude between −180 and 180']
    ]],
    ['Strings', 'Constraints on string fields.', [
      ["@MinLength(n)", 'must be longer than or equal to n characters'],
      ["@MaxLength(n)", 'must be shorter than or equal to n characters'],
      ["@Length(min, max?)", 'must be between min and max characters, or at least min if max is omitted'],
      ["@Email()", 'must be a valid email'],
      ["@IsUrl()", 'must be a valid URL'],
      ["@IsUUID(version?)", 'must be a valid UUID'],
      ["@IsIP(version?)", 'must be a valid IP address'],
      ["@Matches(regex)", 'must match the regular expression'],
      ["@IsAlpha()", 'must contain only letters'],
      ["@IsAlphanumeric()", 'must contain only letters and numbers'],
      ["@IsLowercase()", 'must be lowercase'],
      ["@IsUppercase()", 'must be uppercase'],
      ["@IsSemVer()", 'must be a valid semantic version'],
      ["@IsHexColor()", 'must be a hex color'],
      ["@IsNumberString()", 'must be a number string'],
      ["@IsDateString()", 'must be a valid ISO 8601 date string'],
      ["@IsJSON()", 'must be a JSON string'],
      ["@Contains(text)", 'must contain the substring'],
      ["@NotContains(text)", 'must not contain the substring'],
      ["@StartsWith(text)", 'must start with the prefix'],
      ["@EndsWith(text)", 'must end with the suffix']
    ]],
    ['Equality and membership', 'Pinning a field to specific values. These narrow the field’s type too.', [
      ["@Equals(value)", 'must equal the value'],
      ["@NotEquals(value)", 'must not equal the value'],
      ["@IsIn(values)", 'must be one of the listed values'],
      ["@IsNotIn(values)", 'must not be one of the listed values'],
      ["@IsEnum(Enum)", 'must be a member of the enum'],
      ["@IsInstance(Class)", 'must be an instance of the class']
    ]],
    ['Arrays', 'Constraints on array fields.', [
      ["@IsArray()", 'must be an array'],
      ["@ArrayNotEmpty()", 'must not be empty'],
      ["@ArrayMinSize(n)", 'must contain at least n elements'],
      ["@ArrayMaxSize(n)", 'must contain at most n elements'],
      ["@ArrayUnique(by?)", 'must not contain duplicate values'],
      ["@ArrayContains(values)", 'must contain all the listed values'],
      ["@ArrayNotContains(values)", 'must not contain any of the listed values']
    ]],
    ['Dates', 'Both take a thunk, so a moving boundary is evaluated per validation.', [
      ["@MinDate(() => date)", 'must not be earlier than the date'],
      ["@MaxDate(() => date)", 'must not be later than the date']
    ]],
    ['Custom rules', 'When the built-ins run out.', [
      ["@Validate(constraint, options?)", 'applies a custom validator class or function'],
      ["defineRule(Class, field, rule)", 'registers a rule from outside a decorator']
    ]],
    ['Reading JSON', 'Every one of these has a …Sync twin that needs no await.', [
      ["toInstance(Class, plain, options?)", 'plain object → validated instance'],
      ["fromJson(Class, json, options?)", 'JSON string → validated instance'],
      ["toInstanceArray(Class, plain, options?)", 'array of plain objects → instances'],
      ["fromJsonArray(Class, json, options?)", 'JSON array string → instances'],
      ["fromRequest(Class, request, options?)", 'reads and maps a Request body — async only']
    ]],
    ['Writing JSON', 'Also available as toPlainSync and toJsonSync.', [
      ["toPlain(instance, options?)", 'instance → plain object'],
      ["toJson(instance, options?)", 'instance → JSON string']
    ]],
    ['Validating', 'Also available as validateSync and validateOrRejectSync.', [
      ["validate(instance, options?)", 'returns ValidationError[]'],
      ["validateOrReject(instance, options?)", 'throws JsonValidationError on failure']
    ]],
    ['Errors', 'Turning a ValidationError tree into something you can show.', [
      ["flattenErrors(errors)", "nested errors → { 'path.to.field': messages }"],
      ["formatErrors(errors)", 'errors → readable multi-line text'],
      ["collectErrorMessages(errors)", 'every message as a flat array of strings'],
      ["JsonValidationError", 'thrown when validation fails'],
      ["JsonMappingError", 'thrown when a value cannot be mapped at all']
    ]],
    ['Configuration', 'Per call, or once via configure().', [
      ["validate: boolean", 'validate while mapping — default true'],
      ["namingStrategy: strategy", 'identity (default), camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case, or your own function'],
      ["unknownKeys: policy", 'allow (default), strip, or error'],
      ["maxDepth: number", 'nesting limit before a JsonMappingError — default 64'],
      ["configure(options)", 'sets the library-wide defaults']
    ]],
    ['Build', 'Only needed on toolchains that transform with oxc.', [
      ["standardDecorators(options?)", "the Vite and Vitest plugin, from 'cereale/vite'"]
    ]]
  ];

  var groupsEl = document.getElementById('ref-groups');
  var filterEl = document.getElementById('ref-filter');
  var refCountEl = document.getElementById('ref-count');

  if (groupsEl) {
    groupsEl.innerHTML = REFERENCE.map(function (group) {
      var items = group[2].map(function (item) {
        return '<li data-search="' + esc((item[0] + ' ' + item[1]).toLowerCase()) + '">' +
          '<code>' + esc(item[0]) + '</code>' +
          '<span class="sum">' + esc(item[1]) + '</span></li>';
      }).join('');
      return '<div class="ref-group" data-group>' +
        '<h3>' + esc(group[0]) + '</h3>' +
        '<p class="blurb">' + esc(group[1]) + '</p>' +
        '<ul>' + items + '</ul></div>';
    }).join('');

    var allItems = groupsEl.querySelectorAll('li[data-search]');
    var allGroups = groupsEl.querySelectorAll('[data-group]');
    var totalEntries = allItems.length;

    var applyFilter = function () {
      var term = (filterEl ? filterEl.value : '').trim().toLowerCase();
      var shown = 0;
      Array.prototype.forEach.call(allGroups, function (group) {
        var visibleInGroup = 0;
        Array.prototype.forEach.call(group.querySelectorAll('li[data-search]'), function (li) {
          var hit = !term || li.getAttribute('data-search').indexOf(term) !== -1;
          li.hidden = !hit;
          if (hit) { visibleInGroup++; shown++; }
        });
        group.hidden = visibleInGroup === 0;
      });
      if (refCountEl) {
        refCountEl.textContent = term
          ? shown + ' of ' + totalEntries + ' shown'
          : totalEntries + ' entries';
      }
    };

    applyFilter();
    if (filterEl) filterEl.addEventListener('input', applyFilter);
  }

  /* --------------------------------------------------------- playground */
  var EXAMPLES = [
    {
      label: 'Mapping',
      code: [
        "// Rename a field, keep a secret out of the response,",
        "// and get a real instance back — methods and all.",
        "class User {",
        "  @JsonProperty('display_name')",
        "  @IsString() @MinLength(3)",
        "  displayName!: string;",
        "",
        "  @IsInt() @Min(18)",
        "  age!: number;",
        "",
        "  // accepted on input, never written back out",
        "  @JsonWriteOnly() @IsString()",
        "  password!: string;",
        "",
        "  greet() { return 'Hi ' + this.displayName; }",
        "}",
        "",
        "const body = '{\"display_name\":\"Ada\",\"age\":36,' +",
        "             '\"password\":\"hunter2\"}';",
        "const user = fromJsonSync(User, body);",
        "",
        "console.log('a real User:', user instanceof User);",
        "console.log('its methods survived:', user.greet());",
        "console.log('back out again:', toJsonSync(user));"
      ].join('\n')
    },
    {
      label: 'Validation errors',
      code: [
        "class Signup {",
        "  @IsString() @MinLength(3)  name!: string;",
        "  @IsInt() @Min(18)          age!: number;",
        "  @Email()                   email!: string;",
        "}",
        "",
        "// Map without validating so we can inspect the damage ourselves.",
        "const payload = { name: 'Bo', age: 15, email: 'nope' };",
        "const bad = toInstanceSync(Signup, payload, { validate: false });",
        "",
        "console.log(formatErrors(validateSync(bad)));",
        "console.log('');",
        "console.log('as a map for a form:', flattenErrors(validateSync(bad)));",
        "",
        "// Or let it throw, which is the default.",
        "try {",
        "  fromJsonSync(Signup, JSON.stringify(payload));",
        "} catch (error) {",
        "  console.log('');",
        "  console.log('threw:', error.name);",
        "}"
      ].join('\n')
    },
    {
      label: 'Nested',
      code: [
        "class Line {",
        "  @IsString()        sku!: string;",
        "  @IsInt() @Min(1)   qty!: number;",
        "}",
        "",
        "class Order {",
        "  @IsString() ref!: string;",
        "",
        "  @ValidateNested({ each: true })",
        "  @JsonType(() => Line)",
        "  lines!: Line[];",
        "}",
        "",
        "const order = toInstanceSync(Order,",
        "  { ref: 'A-1', lines: [",
        "    { sku: 'grain', qty: 2 },",
        "    { sku: 'oat',   qty: 0 },   // ← the one that fails",
        "  ] },",
        "  { validate: false });",
        "",
        "console.log('nested items are real:', order.lines[0] instanceof Line);",
        "console.log('errors keep their path:', flattenErrors(validateSync(order)));"
      ].join('\n')
    },
    {
      label: 'Polymorphism',
      code: [
        "class Media { @IsString() title!: string; }",
        "",
        "class Movie extends Media {",
        "  @IsInt() @Min(1) duration!: number;",
        "  hours() { return (this.duration / 60).toFixed(2); }",
        "}",
        "class Song extends Media { @IsString() artist!: string; }",
        "",
        "class Playlist {",
        "  @JsonPolymorphic('type', [",
        "    { value: Movie, name: 'movie' },",
        "    { value: Song,  name: 'song'  },",
        "  ])",
        "  @ValidateNested({ each: true })",
        "  items!: Media[];",
        "}",
        "",
        "const list = toInstanceSync(Playlist, { items: [",
        "  { type: 'movie', title: 'Inception', duration: 148 },",
        "  { type: 'song',  title: 'Reckoner', artist: 'Radiohead' },",
        "] });",
        "",
        "console.log('first is a Movie:', list.items[0] instanceof Movie);",
        "console.log('and it has behaviour:', list.items[0].hours() + ' hours');",
        "console.log('second is a Song:', list.items[1].constructor.name);"
      ].join('\n')
    },
    {
      label: 'Naming',
      code: [
        "// One setting instead of a @JsonProperty on every field.",
        "class Account {",
        "  @IsString() firstName!: string;",
        "  @IsString() lastName!: string;",
        "  @IsString() emailAddress!: string;",
        "}",
        "",
        "const options = { namingStrategy: 'snake_case' };",
        "",
        "const account = toInstanceSync(Account,",
        "  { first_name: 'Ada', last_name: 'Lovelace',",
        "    email_address: 'ada@example.com' },",
        "  options);",
        "",
        "console.log('read:', account.firstName, account.lastName);",
        "console.log('written:', toPlainSync(account, options));"
      ].join('\n')
    },
    {
      label: 'Nothing fails quietly',
      code: [
        "// Each of these used to succeed and lose your data, or fail somewhere",
        "// unrelated. Run it and read what comes back instead.",
        "",
        "class Basket { items: any; }",
        "",
        "const basket = new Basket();",
        "basket.items = new Map([['grain', 2]]);",
        "",
        "try { toPlainSync(basket, { validate: false }); }",
        "catch (error) { console.log(error.name + ': ' + error.message); }",
        "",
        "console.log('');",
        "",
        "class Node { name = 'root'; child: any = null; parent: any = null; }",
        "const root = new Node(), child = new Node();",
        "child.name = 'child'; child.parent = root; root.child = child;",
        "",
        "try { toPlainSync(root, { validate: false }); }",
        "catch (error) { console.log(error.name + ': ' + error.message); }",
        "",
        "console.log('');",
        "",
        "class Strict { @IsString() a!: string; }",
        "try { toInstanceSync(Strict, { a: 'x', b: 'y' }, { unknownKeys: 'error' }); }",
        "catch (error) { console.log(error.name + ': ' + error.message); }"
      ].join('\n')
    }
  ];

  var editor = document.getElementById('editor');
  var output = document.getElementById('output');
  var runBtn = document.getElementById('run-btn');
  var tabsEl = document.getElementById('tabs');
  var statusEl = document.getElementById('pg-status');

  if (editor && output && runBtn && tabsEl) {
    tabsEl.innerHTML = EXAMPLES.map(function (example, index) {
      return '<button class="tab" type="button" data-example="' + index + '"' +
        ' aria-pressed="' + (index === 0 ? 'true' : 'false') + '">' + esc(example.label) + '</button>';
    }).join('');

    var selectExample = function (index) {
      Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-example]'), function (tab) {
        tab.setAttribute('aria-pressed', tab.getAttribute('data-example') === String(index) ? 'true' : 'false');
      });
      editor.value = EXAMPLES[index].code;
      // The compiler is only fetched on the first run, so the pane starts empty; say why
      // rather than showing a blank box.
      output.innerHTML = '<span class="out-dim">Press Run (or ' +
        (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl') +
        '+Enter) to compile this and execute it\nagainst the bundled library.</span>';
      if (statusEl) statusEl.textContent = '';
    };

    tabsEl.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-example]');
      if (tab) selectExample(parseInt(tab.getAttribute('data-example'), 10));
    });

    // Tab indents rather than escaping the editor; Escape then Tab still moves focus out.
    var tabEscapes = false;
    editor.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { tabEscapes = true; return; }
      if (event.key !== 'Tab' || tabEscapes) { tabEscapes = false; return; }
      event.preventDefault();
      var start = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
    });

    var write = function (text, cls) {
      var line = document.createElement('span');
      if (cls) line.className = cls;
      line.textContent = text + '\n';
      output.appendChild(line);
    };

    var show = function (value) {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.name + ': ' + value.message;
      try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
    };

    // The compiler is ~540KB gzipped, so it is fetched on the first run rather than
    // charged to everyone who scrolls past.
    var compiler = null;
    var loadCompiler = function () {
      return compiler || (compiler = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'vendor/babel.min.js';
        script.onload = function () { resolve(window.Babel); };
        script.onerror = function () { reject(new Error('Could not load the compiler (vendor/babel.min.js).')); };
        document.head.appendChild(script);
      }));
    };

    var running = false;
    var run = function () {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      output.textContent = '';
      if (statusEl) statusEl.textContent = window.Babel ? 'running…' : 'loading compiler…';

      loadCompiler().then(function (Babel) {
        if (statusEl) statusEl.textContent = 'running…';
        // TypeScript is stripped first, then decorators are lowered: the other order
        // leaves the decorator transform's initialisers on a `field!: T` declaration,
        // which the TypeScript plugin then rejects.
        var compiled = Babel.transform(editor.value, {
          filename: 'playground.ts',
          plugins: [['transform-typescript', {}], ['proposal-decorators', { version: '2023-11' }]]
        }).code;

        var sandboxConsole = {
          log: function () {
            write(Array.prototype.map.call(arguments, show).join(' '));
          }
        };
        var body = 'return (async () => {\n' + compiled + '\n})();';
        var fn = Function.apply(null, ['console'].concat(exportNames, [body]));
        return fn.apply(null, [sandboxConsole].concat(exportNames.map(function (name) {
          return window.Cereale[name];
        })));
      }).then(function () {
        if (!output.textContent) write('(the code ran, but logged nothing)', 'out-dim');
      }).catch(function (error) {
        write((error && error.name === 'SyntaxError' ? '' : '') + show(error), 'out-err');
      }).then(function () {
        running = false;
        runBtn.disabled = false;
        if (statusEl) statusEl.textContent = '';
      });
    };

    runBtn.addEventListener('click', run);
    editor.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); run(); }
    });

    selectExample(0);
  }
})();
