import type { Disposable, Event, CancellationToken } from './types';

// ============================================================================
// Podex Extension API
// ============================================================================
// This is the API surface exposed to extensions via the `podex` global

export interface PodexApi {
  // Version info
  version: string;

  // Namespaces
  window: WindowApi;
  workspace: WorkspaceApi;
  languages: LanguagesApi;
  commands: CommandsApi;
  env: EnvApi;
}

// ============================================================================
// Window API
// ============================================================================

export interface WindowApi {
  // Messages
  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;

  // Quick picks
  showQuickPick(
    items: QuickPickItem[] | string[],
    options?: QuickPickOptions
  ): Promise<QuickPickItem | string | undefined>;

  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;

  // Progress
  withProgress<T>(
    options: ProgressOptions,
    task: (progress: Progress<ProgressMessage>, token: CancellationToken) => Promise<T>
  ): Promise<T>;

  // Status bar
  createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;

  // Output channels
  createOutputChannel(name: string): OutputChannel;

  // Terminals
  createTerminal(name?: string, shellPath?: string, shellArgs?: string[]): Terminal;

  // Active editor
  readonly activeTextEditor: TextEditor | undefined;
  readonly visibleTextEditors: readonly TextEditor[];
  onDidChangeActiveTextEditor: Event<TextEditor | undefined>;
  onDidChangeVisibleTextEditors: Event<readonly TextEditor[]>;

  // Text document events
  onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
}

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
  alwaysShow?: boolean;
}

export interface QuickPickOptions {
  title?: string;
  placeHolder?: string;
  canPickMany?: boolean;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
}

export interface InputBoxOptions {
  title?: string;
  prompt?: string;
  placeHolder?: string;
  value?: string;
  password?: boolean;
  validateInput?(value: string): string | undefined | null | Promise<string | undefined | null>;
}

export interface ProgressOptions {
  location: ProgressLocation;
  title?: string;
  cancellable?: boolean;
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
}

export interface Progress<T> {
  report(value: T): void;
}

export interface ProgressMessage {
  message?: string;
  increment?: number;
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export interface StatusBarItem {
  alignment: StatusBarAlignment;
  priority: number;
  text: string;
  tooltip: string | undefined;
  color: string | undefined;
  backgroundColor: string | undefined;
  command: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface OutputChannel {
  name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
}

export interface Terminal {
  name: string;
  processId: Promise<number | undefined>;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
}

export interface TextEditor {
  document: TextDocument;
  selection: Selection;
  selections: readonly Selection[];
  visibleRanges: readonly Range[];
  options: TextEditorOptions;
  edit(callback: (editBuilder: TextEditorEdit) => void): Promise<boolean>;
  insertSnippet(
    snippet: string,
    location?: Position | Range | readonly Position[] | readonly Range[]
  ): Promise<boolean>;
  setDecorations(decorationType: TextEditorDecorationType, ranges: Range[]): void;
  revealRange(range: Range, revealType?: TextEditorRevealType): void;
}

export interface TextEditorOptions {
  tabSize?: number | string;
  insertSpaces?: boolean | string;
  cursorStyle?: TextEditorCursorStyle;
  lineNumbers?: TextEditorLineNumbersStyle;
}

export enum TextEditorCursorStyle {
  Line = 1,
  Block = 2,
  Underline = 3,
}

export enum TextEditorLineNumbersStyle {
  Off = 0,
  On = 1,
  Relative = 2,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export interface TextEditorEdit {
  replace(location: Position | Range | Selection, value: string): void;
  insert(location: Position, value: string): void;
  delete(location: Range | Selection): void;
}

export interface TextEditorDecorationType {
  key: string;
  dispose(): void;
}

export interface TextEditorSelectionChangeEvent {
  textEditor: TextEditor;
  selections: readonly Selection[];
  kind: TextEditorSelectionChangeKind | undefined;
}

export enum TextEditorSelectionChangeKind {
  Keyboard = 1,
  Mouse = 2,
  Command = 3,
}

// ============================================================================
// Workspace API
// ============================================================================

export interface WorkspaceApi {
  // Workspace folders
  readonly workspaceFolders: readonly WorkspaceFolder[] | undefined;
  readonly name: string | undefined;
  onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;

  // File system
  readonly fs: FileSystem;

  // Text documents
  openTextDocument(uri: Uri): Promise<TextDocument>;
  openTextDocument(path: string): Promise<TextDocument>;
  onDidOpenTextDocument: Event<TextDocument>;
  onDidCloseTextDocument: Event<TextDocument>;
  onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
  onDidSaveTextDocument: Event<TextDocument>;

  // Configuration
  getConfiguration(section?: string): WorkspaceConfiguration;
  onDidChangeConfiguration: Event<ConfigurationChangeEvent>;

  // File system operations
  findFiles(include: string, exclude?: string, maxResults?: number): Promise<Uri[]>;
  createFileSystemWatcher(pattern: string): FileSystemWatcher;

  // Apply edits
  applyEdit(edit: WorkspaceEdit): Promise<boolean>;
}

export interface WorkspaceFolder {
  uri: Uri;
  name: string;
  index: number;
}

export interface WorkspaceFoldersChangeEvent {
  added: readonly WorkspaceFolder[];
  removed: readonly WorkspaceFolder[];
}

export interface FileSystem {
  stat(uri: Uri): Promise<FileStat>;
  readDirectory(uri: Uri): Promise<[string, FileType][]>;
  readFile(uri: Uri): Promise<Uint8Array>;
  writeFile(uri: Uri, content: Uint8Array): Promise<void>;
  delete(uri: Uri, options?: { recursive?: boolean }): Promise<void>;
  rename(source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void>;
  copy(source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void>;
  createDirectory(uri: Uri): Promise<void>;
}

export interface FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface FileSystemWatcher {
  onDidCreate: Event<Uri>;
  onDidChange: Event<Uri>;
  onDidDelete: Event<Uri>;
  dispose(): void;
}

export interface TextDocument {
  uri: Uri;
  fileName: string;
  languageId: string;
  version: number;
  isDirty: boolean;
  isUntitled: boolean;
  isClosed: boolean;
  lineCount: number;
  getText(range?: Range): string;
  lineAt(line: number): TextLine;
  lineAt(position: Position): TextLine;
  offsetAt(position: Position): number;
  positionAt(offset: number): Position;
  validateRange(range: Range): Range;
  validatePosition(position: Position): Position;
  save(): Promise<boolean>;
}

export interface TextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

export interface TextDocumentChangeEvent {
  document: TextDocument;
  contentChanges: readonly TextDocumentContentChangeEvent[];
}

export interface TextDocumentContentChangeEvent {
  range: Range;
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export interface WorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
  has(section: string): boolean;
  update(section: string, value: unknown, global?: boolean): Promise<void>;
}

export interface ConfigurationChangeEvent {
  affectsConfiguration(section: string): boolean;
}

export interface WorkspaceEdit {
  size: number;
  replace(uri: Uri, range: Range, newText: string): void;
  insert(uri: Uri, position: Position, newText: string): void;
  delete(uri: Uri, range: Range): void;
  has(uri: Uri): boolean;
  set(uri: Uri, edits: TextEdit[]): void;
  get(uri: Uri): TextEdit[];
  entries(): [Uri, TextEdit[]][];
}

export interface TextEdit {
  range: Range;
  newText: string;
}

// ============================================================================
// Languages API
// ============================================================================

export interface LanguagesApi {
  // Document selectors
  match(selector: DocumentSelector, document: TextDocument): number;

  // Diagnostics
  createDiagnosticCollection(name?: string): DiagnosticCollection;

  // Language features
  registerCompletionItemProvider(
    selector: DocumentSelector,
    provider: CompletionItemProvider,
    ...triggerCharacters: string[]
  ): Disposable;

  registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable;

  registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): Disposable;

  registerDocumentSymbolProvider(
    selector: DocumentSelector,
    provider: DocumentSymbolProvider
  ): Disposable;

  registerCodeActionsProvider(
    selector: DocumentSelector,
    provider: CodeActionProvider,
    metadata?: CodeActionProviderMetadata
  ): Disposable;

  registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable;

  registerDocumentFormattingEditProvider(
    selector: DocumentSelector,
    provider: DocumentFormattingEditProvider
  ): Disposable;

  registerOnTypeFormattingEditProvider(
    selector: DocumentSelector,
    provider: OnTypeFormattingEditProvider,
    firstTriggerCharacter: string,
    ...moreTriggerCharacter: string[]
  ): Disposable;
}

export type DocumentSelector = DocumentFilter | string | readonly (DocumentFilter | string)[];

export interface DocumentFilter {
  language?: string;
  scheme?: string;
  pattern?: string;
}

export interface DiagnosticCollection {
  name: string;
  set(uri: Uri, diagnostics: Diagnostic[] | undefined): void;
  set(entries: [Uri, Diagnostic[] | undefined][]): void;
  delete(uri: Uri): void;
  clear(): void;
  forEach(
    callback: (
      uri: Uri,
      diagnostics: readonly Diagnostic[],
      collection: DiagnosticCollection
    ) => void
  ): void;
  get(uri: Uri): readonly Diagnostic[] | undefined;
  has(uri: Uri): boolean;
  dispose(): void;
}

export interface Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number | { value: string | number; target: Uri };
  relatedInformation?: DiagnosticRelatedInformation[];
  tags?: DiagnosticTag[];
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface CompletionItemProvider {
  provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList>;
  resolveCompletionItem?(
    item: CompletionItem,
    token: CancellationToken
  ): ProviderResult<CompletionItem>;
}

export interface CompletionContext {
  triggerKind: CompletionTriggerKind;
  triggerCharacter: string | undefined;
}

export enum CompletionTriggerKind {
  Invoke = 0,
  TriggerCharacter = 1,
  TriggerForIncompleteCompletions = 2,
}

export interface CompletionItem {
  label: string | CompletionItemLabel;
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkdownString;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  insertText?: string;
  range?: Range;
  command?: Command;
  additionalTextEdits?: TextEdit[];
}

export interface CompletionItemLabel {
  label: string;
  detail?: string;
  description?: string;
}

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  Enum = 12,
  Keyword = 13,
  Snippet = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  EnumMember = 19,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24,
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface HoverProvider {
  provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Hover>;
}

export interface Hover {
  contents: MarkdownString | MarkedString | (MarkdownString | MarkedString)[];
  range?: Range;
}

export type MarkedString = string | { language: string; value: string };

export interface DefinitionProvider {
  provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>;
}

export type Definition = Location | Location[];

export interface DefinitionLink {
  originSelectionRange?: Range;
  targetUri: Uri;
  targetRange: Range;
  targetSelectionRange?: Range;
}

export interface DocumentSymbolProvider {
  provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<DocumentSymbol[] | SymbolInformation[]>;
}

export interface DocumentSymbol {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface SymbolInformation {
  name: string;
  containerName: string;
  kind: SymbolKind;
  location: Location;
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  String = 14,
  Number = 15,
  Boolean = 16,
  Array = 17,
  Object = 18,
  Key = 19,
  Null = 20,
  EnumMember = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export interface CodeActionProvider {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): ProviderResult<(Command | CodeAction)[]>;
  resolveCodeAction?(codeAction: CodeAction, token: CancellationToken): ProviderResult<CodeAction>;
}

export interface CodeActionContext {
  diagnostics: readonly Diagnostic[];
  only: CodeActionKind | undefined;
  triggerKind: CodeActionTriggerKind;
}

export enum CodeActionTriggerKind {
  Invoke = 1,
  Automatic = 2,
}

export class CodeActionKind {
  static readonly Empty = new CodeActionKind('');
  static readonly QuickFix = new CodeActionKind('quickfix');
  static readonly Refactor = new CodeActionKind('refactor');
  static readonly RefactorExtract = new CodeActionKind('refactor.extract');
  static readonly RefactorInline = new CodeActionKind('refactor.inline');
  static readonly RefactorRewrite = new CodeActionKind('refactor.rewrite');
  static readonly Source = new CodeActionKind('source');
  static readonly SourceOrganizeImports = new CodeActionKind('source.organizeImports');
  static readonly SourceFixAll = new CodeActionKind('source.fixAll');

  constructor(public readonly value: string) {}

  append(parts: string): CodeActionKind {
    return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts);
  }

  intersects(other: CodeActionKind): boolean {
    return (
      this.value === other.value ||
      this.value.startsWith(other.value + '.') ||
      other.value.startsWith(this.value + '.')
    );
  }

  contains(other: CodeActionKind): boolean {
    return this.value === other.value || other.value.startsWith(this.value + '.');
  }
}

export interface CodeActionProviderMetadata {
  providedCodeActionKinds?: readonly CodeActionKind[];
}

export interface CodeAction {
  title: string;
  kind?: CodeActionKind;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: Command;
}

export interface CodeLensProvider {
  onDidChangeCodeLenses?: Event<void>;
  provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>;
  resolveCodeLens?(codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
}

export interface CodeLens {
  range: Range;
  command?: Command;
  isResolved: boolean;
}

export interface DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>;
}

export interface OnTypeFormattingEditProvider {
  provideOnTypeFormattingEdits(
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>;
}

export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

// ============================================================================
// Commands API
// ============================================================================

export interface CommandsApi {
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
    thisArg?: unknown
  ): Disposable;
  registerTextEditorCommand(
    command: string,
    callback: (textEditor: TextEditor, edit: TextEditorEdit, ...args: unknown[]) => void,
    thisArg?: unknown
  ): Disposable;
  executeCommand<T>(command: string, ...args: unknown[]): Promise<T>;
  getCommands(filterInternal?: boolean): Promise<string[]>;
}

export interface Command {
  title: string;
  command: string;
  tooltip?: string;
  arguments?: unknown[];
}

// ============================================================================
// Environment API
// ============================================================================

export interface EnvApi {
  readonly appName: string;
  readonly appRoot: string;
  readonly language: string;
  readonly machineId: string;
  readonly sessionId: string;
  readonly uriScheme: string;
  readonly clipboard: Clipboard;
  readonly shell: string;
  openExternal(target: Uri): Promise<boolean>;
}

export interface Clipboard {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

// ============================================================================
// Common Types
// ============================================================================

export class Uri {
  static parse(value: string): Uri {
    return new Uri(value);
  }

  static file(path: string): Uri {
    return new Uri(`file://${path}`);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const joined = pathSegments.join('/');
    return new Uri(`${base.toString()}/${joined}`);
  }

  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;

  constructor(private readonly _value: string) {
    const url = new URL(_value);
    this.scheme = url.protocol.replace(':', '');
    this.authority = url.host;
    this.path = url.pathname;
    this.query = url.search.replace('?', '');
    this.fragment = url.hash.replace('#', '');
    this.fsPath = this.scheme === 'file' ? decodeURIComponent(this.path) : this.path;
  }

  toString(): string {
    return this._value;
  }

  toJSON(): string {
    return this._value;
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    const url = new URL(this._value);
    if (change.scheme) url.protocol = change.scheme + ':';
    if (change.authority !== undefined) url.host = change.authority;
    if (change.path !== undefined) url.pathname = change.path;
    if (change.query !== undefined) url.search = change.query ? '?' + change.query : '';
    if (change.fragment !== undefined) url.hash = change.fragment ? '#' + change.fragment : '';
    return new Uri(url.toString());
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}

  isBefore(other: Position): boolean {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }

  isBeforeOrEqual(other: Position): boolean {
    return (
      this.line < other.line || (this.line === other.line && this.character <= other.character)
    );
  }

  isAfter(other: Position): boolean {
    return !this.isBeforeOrEqual(other);
  }

  isAfterOrEqual(other: Position): boolean {
    return !this.isBefore(other);
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  compareTo(other: Position): number {
    if (this.line < other.line) return -1;
    if (this.line > other.line) return 1;
    if (this.character < other.character) return -1;
    if (this.character > other.character) return 1;
    return 0;
  }

  translate(lineDelta?: number, characterDelta?: number): Position;
  translate(change: { lineDelta?: number; characterDelta?: number }): Position;
  translate(
    lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
    characterDelta?: number
  ): Position {
    if (typeof lineDeltaOrChange === 'object') {
      return new Position(
        this.line + (lineDeltaOrChange.lineDelta || 0),
        this.character + (lineDeltaOrChange.characterDelta || 0)
      );
    }
    return new Position(
      this.line + (lineDeltaOrChange || 0),
      this.character + (characterDelta || 0)
    );
  }

  with(line?: number, character?: number): Position;
  with(change: { line?: number; character?: number }): Position;
  with(
    lineOrChange?: number | { line?: number; character?: number },
    character?: number
  ): Position {
    if (typeof lineOrChange === 'object') {
      return new Position(lineOrChange.line ?? this.line, lineOrChange.character ?? this.character);
    }
    return new Position(lineOrChange ?? this.line, character ?? this.character);
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    startOrStartLine: Position | number,
    endOrStartCharacter: Position | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (typeof startOrStartLine === 'number') {
      this.start = new Position(startOrStartLine, endOrStartCharacter as number);
      this.end = new Position(endLine!, endCharacter!);
    } else {
      this.start = startOrStartLine;
      this.end = endOrStartCharacter as Position;
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return (
        this.start.isBeforeOrEqual(positionOrRange) && this.end.isAfterOrEqual(positionOrRange)
      );
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  intersection(range: Range): Range | undefined {
    const start = Position.prototype.isAfter.call(this.start, range.start)
      ? this.start
      : range.start;
    const end = Position.prototype.isBefore.call(this.end, range.end) ? this.end : range.end;
    if (start.isAfter(end)) return undefined;
    return new Range(start, end);
  }

  union(other: Range): Range {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new Range(start, end);
  }

  with(start?: Position, end?: Position): Range;
  with(change: { start?: Position; end?: Position }): Range;
  with(startOrChange?: Position | { start?: Position; end?: Position }, end?: Position): Range {
    if (typeof startOrChange === 'object' && !(startOrChange instanceof Position)) {
      return new Range(startOrChange.start ?? this.start, startOrChange.end ?? this.end);
    }
    return new Range(startOrChange ?? this.start, end ?? this.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position);
  constructor(
    anchorLine: number,
    anchorCharacter: number,
    activeLine: number,
    activeCharacter: number
  );
  constructor(
    anchorOrAnchorLine: Position | number,
    activeOrAnchorCharacter: Position | number,
    activeLine?: number,
    activeCharacter?: number
  ) {
    if (typeof anchorOrAnchorLine === 'number') {
      const anchorPos = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number);
      const activePos = new Position(activeLine!, activeCharacter!);
      super(
        anchorPos.isBefore(activePos) ? anchorPos : activePos,
        anchorPos.isBefore(activePos) ? activePos : anchorPos
      );
      this.anchor = anchorPos;
      this.active = activePos;
    } else {
      const anchor = anchorOrAnchorLine;
      const active = activeOrAnchorCharacter as Position;
      super(anchor.isBefore(active) ? anchor : active, anchor.isBefore(active) ? active : anchor);
      this.anchor = anchor;
      this.active = active;
    }
  }

  get isReversed(): boolean {
    return this.anchor.isAfter(this.active);
  }
}

export interface Location {
  uri: Uri;
  range: Range;
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  constructor(value?: string, supportThemeIcons?: boolean) {
    this.value = value || '';
    this.supportThemeIcons = supportThemeIcons;
  }

  appendText(value: string): MarkdownString {
    this.value += value.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language?: string): MarkdownString {
    this.value += '\n```' + (language || '') + '\n' + value + '\n```\n';
    return this;
  }
}

export type ProviderResult<T> = T | undefined | null | Promise<T | undefined | null>;
