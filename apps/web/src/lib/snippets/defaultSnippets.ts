/**
 * Default Snippets for Common Languages
 *
 * These snippets are registered by default when the editor loads.
 */

import { getSnippetManager, type SnippetCollection } from './SnippetManager';

// ============================================================================
// TypeScript/JavaScript Snippets
// ============================================================================

const typescriptSnippets: SnippetCollection = {
  // React/Component snippets
  rfc: {
    prefix: 'rfc',
    name: 'React Functional Component',
    description: 'Create a React functional component',
    body: [
      "import { type FC } from 'react';",
      '',
      'interface ${1:Component}Props {',
      '  $2',
      '}',
      '',
      'export const ${1:Component}: FC<${1:Component}Props> = ({ $3 }) => {',
      '  return (',
      '    <div>',
      '      $0',
      '    </div>',
      '  );',
      '};',
    ],
  },
  rfce: {
    prefix: 'rfce',
    name: 'React Functional Component (Export Default)',
    description: 'Create a React functional component with default export',
    body: [
      "import { type FC } from 'react';",
      '',
      'interface ${1:Component}Props {',
      '  $2',
      '}',
      '',
      'const ${1:Component}: FC<${1:Component}Props> = ({ $3 }) => {',
      '  return (',
      '    <div>',
      '      $0',
      '    </div>',
      '  );',
      '};',
      '',
      'export default ${1:Component};',
    ],
  },
  useState: {
    prefix: 'us',
    name: 'useState Hook',
    description: 'Create a useState hook',
    body: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState<${2:type}>(${3:initial});',
  },
  useEffect: {
    prefix: 'ue',
    name: 'useEffect Hook',
    description: 'Create a useEffect hook',
    body: ['useEffect(() => {', '  $1', '  return () => {', '    $2', '  };', '}, [${3:deps}]);'],
  },
  useCallback: {
    prefix: 'ucb',
    name: 'useCallback Hook',
    description: 'Create a useCallback hook',
    body: ['const ${1:callback} = useCallback(() => {', '  $2', '}, [${3:deps}]);'],
  },
  useMemo: {
    prefix: 'um',
    name: 'useMemo Hook',
    description: 'Create a useMemo hook',
    body: ['const ${1:value} = useMemo(() => {', '  return $2;', '}, [${3:deps}]);'],
  },
  useRef: {
    prefix: 'ur',
    name: 'useRef Hook',
    description: 'Create a useRef hook',
    body: 'const ${1:ref} = useRef<${2:HTMLDivElement}>(null);',
  },

  // Functions
  fn: {
    prefix: 'fn',
    name: 'Function',
    description: 'Create a function',
    body: ['function ${1:name}(${2:params}): ${3:void} {', '  $0', '}'],
  },
  afn: {
    prefix: 'afn',
    name: 'Arrow Function',
    description: 'Create an arrow function',
    body: ['const ${1:name} = (${2:params}): ${3:void} => {', '  $0', '};'],
  },
  asyncfn: {
    prefix: 'asyncfn',
    name: 'Async Function',
    description: 'Create an async function',
    body: ['async function ${1:name}(${2:params}): Promise<${3:void}> {', '  $0', '}'],
  },

  // Control flow
  if: {
    prefix: 'if',
    name: 'If Statement',
    description: 'Create an if statement',
    body: ['if (${1:condition}) {', '  $0', '}'],
  },
  ife: {
    prefix: 'ife',
    name: 'If-Else Statement',
    description: 'Create an if-else statement',
    body: ['if (${1:condition}) {', '  $2', '} else {', '  $0', '}'],
  },
  ifel: {
    prefix: 'ifel',
    name: 'If-Else If-Else Statement',
    description: 'Create an if-else if-else statement',
    body: [
      'if (${1:condition}) {',
      '  $2',
      '} else if (${3:condition}) {',
      '  $4',
      '} else {',
      '  $0',
      '}',
    ],
  },
  tern: {
    prefix: 'tern',
    name: 'Ternary Operator',
    description: 'Create a ternary expression',
    body: '${1:condition} ? ${2:true} : ${3:false}',
  },
  switch: {
    prefix: 'switch',
    name: 'Switch Statement',
    description: 'Create a switch statement',
    body: [
      'switch (${1:key}) {',
      '  case ${2:value}:',
      '    $3',
      '    break;',
      '  default:',
      '    $0',
      '}',
    ],
  },

  // Loops
  for: {
    prefix: 'for',
    name: 'For Loop',
    description: 'Create a for loop',
    body: ['for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {', '  $0', '}'],
  },
  forof: {
    prefix: 'forof',
    name: 'For...of Loop',
    description: 'Create a for...of loop',
    body: ['for (const ${1:item} of ${2:array}) {', '  $0', '}'],
  },
  forin: {
    prefix: 'forin',
    name: 'For...in Loop',
    description: 'Create a for...in loop',
    body: ['for (const ${1:key} in ${2:object}) {', '  $0', '}'],
  },
  while: {
    prefix: 'while',
    name: 'While Loop',
    description: 'Create a while loop',
    body: ['while (${1:condition}) {', '  $0', '}'],
  },

  // Error handling
  trycatch: {
    prefix: 'trycatch',
    name: 'Try-Catch',
    description: 'Create a try-catch block with proper error handling',
    body: [
      'try {',
      '  $1',
      '} catch (error) {',
      '  const message = error instanceof Error ? error.message : "Unknown error";',
      '  ${2:throw new Error(`Operation failed: ${message}`);}',
      '  $0',
      '}',
    ],
  },

  // Classes and types
  class: {
    prefix: 'class',
    name: 'Class',
    description: 'Create a class',
    body: ['class ${1:Name} {', '  constructor(${2:params}) {', '    $3', '  }', '', '  $0', '}'],
  },
  interface: {
    prefix: 'int',
    name: 'Interface',
    description: 'Create an interface',
    body: ['interface ${1:Name} {', '  ${2:property}: ${3:type};$0', '}'],
  },
  type: {
    prefix: 'type',
    name: 'Type Alias',
    description: 'Create a type alias',
    body: 'type ${1:Name} = ${2:type};',
  },
  enum: {
    prefix: 'enum',
    name: 'Enum',
    description: 'Create an enum',
    body: ['enum ${1:Name} {', '  ${2:Value},$0', '}'],
  },

  // Imports/Exports
  imp: {
    prefix: 'imp',
    name: 'Import',
    description: 'Import a module',
    body: "import { $2 } from '${1:module}';",
  },
  impd: {
    prefix: 'impd',
    name: 'Import Default',
    description: 'Import default export',
    body: "import ${2:name} from '${1:module}';",
  },
  exp: {
    prefix: 'exp',
    name: 'Export',
    description: 'Export a named export',
    body: 'export { $1 };',
  },
  expd: {
    prefix: 'expd',
    name: 'Export Default',
    description: 'Export default',
    body: 'export default $1;',
  },

  // Console
  cl: {
    prefix: 'cl',
    name: 'Console Log',
    description: 'Console log',
    body: "console.log('$1', $2);",
  },
  ce: {
    prefix: 'ce',
    name: 'Console Error',
    description: 'Console error',
    body: "console.error('$1', $2);",
  },
  cw: {
    prefix: 'cw',
    name: 'Console Warn',
    description: 'Console warn',
    body: "console.warn('$1', $2);",
  },

  // Testing
  desc: {
    prefix: 'desc',
    name: 'Describe Block',
    description: 'Create a describe block for testing',
    body: ["describe('${1:description}', () => {", '  $0', '});'],
  },
  it: {
    prefix: 'it',
    name: 'It Block',
    description: 'Create an it block for testing',
    body: ["it('${1:description}', () => {", '  $0', '});'],
  },
  ita: {
    prefix: 'ita',
    name: 'It Block (Async)',
    description: 'Create an async it block for testing',
    body: ["it('${1:description}', async () => {", '  $0', '});'],
  },
};

// ============================================================================
// Python Snippets
// ============================================================================

const pythonSnippets: SnippetCollection = {
  def: {
    prefix: 'def',
    name: 'Function Definition',
    description: 'Create a function',
    body: ['def ${1:name}(${2:args}) -> ${3:None}:', '    """${4:docstring}"""', '    $0'],
  },
  adef: {
    prefix: 'adef',
    name: 'Async Function Definition',
    description: 'Create an async function',
    body: ['async def ${1:name}(${2:args}) -> ${3:None}:', '    """${4:docstring}"""', '    $0'],
  },
  class: {
    prefix: 'class',
    name: 'Class Definition',
    description: 'Create a class',
    body: [
      'class ${1:Name}:',
      '    """${2:docstring}"""',
      '',
      '    def __init__(self, ${3:args}) -> None:',
      '        $0',
    ],
  },
  dataclass: {
    prefix: 'dataclass',
    name: 'Dataclass',
    description: 'Create a dataclass',
    body: [
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class ${1:Name}:',
      '    """${2:docstring}"""',
      '    ${3:field}: ${4:str}$0',
    ],
  },
  if: {
    prefix: 'if',
    name: 'If Statement',
    description: 'Create an if statement',
    body: ['if ${1:condition}:', '    $0'],
  },
  ife: {
    prefix: 'ife',
    name: 'If-Else Statement',
    description: 'Create an if-else statement',
    body: ['if ${1:condition}:', '    $2', 'else:', '    $0'],
  },
  ifel: {
    prefix: 'ifel',
    name: 'If-Elif-Else Statement',
    description: 'Create an if-elif-else statement',
    body: ['if ${1:condition}:', '    $2', 'elif ${3:condition}:', '    $4', 'else:', '    $0'],
  },
  for: {
    prefix: 'for',
    name: 'For Loop',
    description: 'Create a for loop',
    body: ['for ${1:item} in ${2:items}:', '    $0'],
  },
  while: {
    prefix: 'while',
    name: 'While Loop',
    description: 'Create a while loop',
    body: ['while ${1:condition}:', '    $0'],
  },
  try: {
    prefix: 'try',
    name: 'Try-Except',
    description: 'Create a try-except block',
    body: ['try:', '    $1', 'except ${2:Exception} as e:', '    $0'],
  },
  tryf: {
    prefix: 'tryf',
    name: 'Try-Except-Finally',
    description: 'Create a try-except-finally block',
    body: ['try:', '    $1', 'except ${2:Exception} as e:', '    $3', 'finally:', '    $0'],
  },
  with: {
    prefix: 'with',
    name: 'With Statement',
    description: 'Create a with statement',
    body: ['with ${1:expression} as ${2:var}:', '    $0'],
  },
  lc: {
    prefix: 'lc',
    name: 'List Comprehension',
    description: 'Create a list comprehension',
    body: '[${1:expr} for ${2:item} in ${3:items}]',
  },
  dc: {
    prefix: 'dc',
    name: 'Dict Comprehension',
    description: 'Create a dict comprehension',
    body: '{${1:key}: ${2:value} for ${3:item} in ${4:items}}',
  },
  main: {
    prefix: 'main',
    name: 'Main Block',
    description: 'Create main execution block',
    body: ['if __name__ == "__main__":', '    $0'],
  },
  imp: {
    prefix: 'imp',
    name: 'Import',
    description: 'Import a module',
    body: 'import ${1:module}',
  },
  from: {
    prefix: 'from',
    name: 'From Import',
    description: 'Import from a module',
    body: 'from ${1:module} import ${2:name}',
  },
  pr: {
    prefix: 'pr',
    name: 'Print',
    description: 'Print statement',
    body: 'print(${1:value})',
  },
  prf: {
    prefix: 'prf',
    name: 'Print F-String',
    description: 'Print with f-string',
    body: 'print(f"${1:message}")',
  },
};

// ============================================================================
// Go Snippets
// ============================================================================

const goSnippets: SnippetCollection = {
  fn: {
    prefix: 'fn',
    name: 'Function',
    description: 'Create a function',
    body: ['func ${1:name}(${2:params}) ${3:returnType} {', '\t$0', '}'],
  },
  meth: {
    prefix: 'meth',
    name: 'Method',
    description: 'Create a method',
    body: ['func (${1:receiver}) ${2:name}(${3:params}) ${4:returnType} {', '\t$0', '}'],
  },
  struct: {
    prefix: 'struct',
    name: 'Struct',
    description: 'Create a struct',
    body: ['type ${1:Name} struct {', '\t${2:field} ${3:type}', '}'],
  },
  interface: {
    prefix: 'int',
    name: 'Interface',
    description: 'Create an interface',
    body: ['type ${1:Name} interface {', '\t${2:Method}() ${3:returnType}', '}'],
  },
  if: {
    prefix: 'if',
    name: 'If Statement',
    description: 'Create an if statement',
    body: ['if ${1:condition} {', '\t$0', '}'],
  },
  iferr: {
    prefix: 'iferr',
    name: 'If Error',
    description: 'Handle error pattern',
    body: ['if err != nil {', '\treturn ${1:err}', '}'],
  },
  for: {
    prefix: 'for',
    name: 'For Loop',
    description: 'Create a for loop',
    body: ['for ${1:i} := 0; ${1:i} < ${2:count}; ${1:i}++ {', '\t$0', '}'],
  },
  forr: {
    prefix: 'forr',
    name: 'For Range',
    description: 'Create a for range loop',
    body: ['for ${1:key}, ${2:value} := range ${3:collection} {', '\t$0', '}'],
  },
  switch: {
    prefix: 'switch',
    name: 'Switch',
    description: 'Create a switch statement',
    body: ['switch ${1:expr} {', 'case ${2:value}:', '\t$3', 'default:', '\t$0', '}'],
  },
  main: {
    prefix: 'main',
    name: 'Main Function',
    description: 'Create main function',
    body: ['func main() {', '\t$0', '}'],
  },
  test: {
    prefix: 'test',
    name: 'Test Function',
    description: 'Create a test function',
    body: ['func Test${1:Name}(t *testing.T) {', '\t$0', '}'],
  },
};

// ============================================================================
// Rust Snippets
// ============================================================================

const rustSnippets: SnippetCollection = {
  fn: {
    prefix: 'fn',
    name: 'Function',
    description: 'Create a function',
    body: ['fn ${1:name}(${2:args}) -> ${3:()} {', '    $0', '}'],
  },
  pfn: {
    prefix: 'pfn',
    name: 'Public Function',
    description: 'Create a public function',
    body: ['pub fn ${1:name}(${2:args}) -> ${3:()} {', '    $0', '}'],
  },
  afn: {
    prefix: 'afn',
    name: 'Async Function',
    description: 'Create an async function',
    body: ['async fn ${1:name}(${2:args}) -> ${3:()} {', '    $0', '}'],
  },
  struct: {
    prefix: 'struct',
    name: 'Struct',
    description: 'Create a struct',
    body: ['struct ${1:Name} {', '    ${2:field}: ${3:Type},$0', '}'],
  },
  impl: {
    prefix: 'impl',
    name: 'Implementation',
    description: 'Create an impl block',
    body: ['impl ${1:Type} {', '    $0', '}'],
  },
  trait: {
    prefix: 'trait',
    name: 'Trait',
    description: 'Create a trait',
    body: ['trait ${1:Name} {', '    fn ${2:method}(&self) -> ${3:()};', '}'],
  },
  enum: {
    prefix: 'enum',
    name: 'Enum',
    description: 'Create an enum',
    body: ['enum ${1:Name} {', '    ${2:Variant},$0', '}'],
  },
  match: {
    prefix: 'match',
    name: 'Match Expression',
    description: 'Create a match expression',
    body: ['match ${1:expr} {', '    ${2:pattern} => $3,', '    _ => $0,', '}'],
  },
  if: {
    prefix: 'if',
    name: 'If Expression',
    description: 'Create an if expression',
    body: ['if ${1:condition} {', '    $0', '}'],
  },
  iflet: {
    prefix: 'iflet',
    name: 'If Let',
    description: 'Create an if let expression',
    body: ['if let ${1:pattern} = ${2:expr} {', '    $0', '}'],
  },
  for: {
    prefix: 'for',
    name: 'For Loop',
    description: 'Create a for loop',
    body: ['for ${1:item} in ${2:iter} {', '    $0', '}'],
  },
  test: {
    prefix: 'test',
    name: 'Test Function',
    description: 'Create a test function',
    body: ['#[test]', 'fn ${1:test_name}() {', '    $0', '}'],
  },
};

// ============================================================================
// HTML/JSX Snippets
// ============================================================================

const htmlSnippets: SnippetCollection = {
  div: {
    prefix: 'div',
    name: 'Div Element',
    description: 'Create a div element',
    body: '<div className="${1:class}">$0</div>',
  },
  span: {
    prefix: 'span',
    name: 'Span Element',
    description: 'Create a span element',
    body: '<span className="${1:class}">$0</span>',
  },
  button: {
    prefix: 'button',
    name: 'Button Element',
    description: 'Create a button element',
    body: '<button onClick={${1:handler}} className="${2:class}">$0</button>',
  },
  input: {
    prefix: 'input',
    name: 'Input Element',
    description: 'Create an input element',
    body: '<input type="${1|text,password,email,number,checkbox,radio|}" value={${2:value}} onChange={${3:handler}} />',
  },
  img: {
    prefix: 'img',
    name: 'Image Element',
    description: 'Create an image element',
    body: '<img src="${1:src}" alt="${2:alt}" />',
  },
  link: {
    prefix: 'link',
    name: 'Link Element',
    description: 'Create a link element',
    body: '<a href="${1:url}">$0</a>',
  },
  ul: {
    prefix: 'ul',
    name: 'Unordered List',
    description: 'Create an unordered list',
    body: ['<ul>', '  <li>$0</li>', '</ul>'],
  },
  map: {
    prefix: 'map',
    name: 'Array Map',
    description: 'Map over an array to render elements',
    body: [
      '{${1:items}.map((${2:item}) => (',
      '  <${3:div} key={${2:item}.id}>$0</${3:div}>',
      '))}',
    ],
  },
};

// ============================================================================
// Register All Default Snippets
// ============================================================================

export function registerDefaultSnippets(): void {
  const manager = getSnippetManager();

  // TypeScript/JavaScript
  manager.registerSnippets('typescript', typescriptSnippets);
  manager.registerSnippets('javascript', typescriptSnippets);
  manager.registerSnippets('typescriptreact', typescriptSnippets);
  manager.registerSnippets('javascriptreact', typescriptSnippets);

  // Python
  manager.registerSnippets('python', pythonSnippets);

  // Go
  manager.registerSnippets('go', goSnippets);

  // Rust
  manager.registerSnippets('rust', rustSnippets);

  // HTML (also applies to JSX)
  manager.registerSnippets('html', htmlSnippets);
  manager.registerSnippets('typescriptreact', htmlSnippets);
  manager.registerSnippets('javascriptreact', htmlSnippets);
}
