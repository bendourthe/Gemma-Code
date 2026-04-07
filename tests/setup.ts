import { resolve } from "path";
import { vi } from "vitest";

// Cross-platform mock workspace root: on Windows this produces a drive-letter
// path like "C:\workspace"; on Linux/macOS it produces "/workspace".
export const MOCK_WORKSPACE_ROOT = resolve("/workspace");

// ---------------------------------------------------------------------------
// Global mock for the "vscode" module, which is only available inside the
// VS Code extension host at runtime. All source files that import vscode will
// receive this mock in the test environment.
// ---------------------------------------------------------------------------

const mockOutputChannel = {
  appendLine: vi.fn(),
  append: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
  name: "Gemma Code",
};

const mockDisposable = { dispose: vi.fn() };

const mockConfigurationChangeEvent = {
  affectsConfiguration: vi.fn(() => false),
};

let _onDidChangeConfigurationListener:
  | ((e: typeof mockConfigurationChangeEvent) => void)
  | null = null;

export const mockGetConfiguration = vi.fn(() => ({
  get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => defaultValue),
}));

export const mockOnDidChangeConfiguration = vi.fn(
  (listener: (e: typeof mockConfigurationChangeEvent) => void) => {
    _onDidChangeConfigurationListener = listener;
    return mockDisposable;
  }
);

export function triggerConfigurationChange(
  affectsConfiguration: (section: string) => boolean
): void {
  if (_onDidChangeConfigurationListener) {
    _onDidChangeConfigurationListener({ affectsConfiguration });
  }
}

// ---------------------------------------------------------------------------
// Functional EventEmitter mock
// Implements real subscribe-and-fire semantics so ConversationManager tests
// can verify onDidChange notifications end-to-end.
// ---------------------------------------------------------------------------

class MockEventEmitter<T> {
  private _listeners: Array<(value: T) => void> = [];

  readonly event = (listener: (value: T) => void): typeof mockDisposable => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      },
    };
  };

  readonly fire = vi.fn((value: T): void => {
    for (const l of this._listeners) l(value);
  });

  readonly dispose = vi.fn((): void => {
    this._listeners = [];
  });
}

// ---------------------------------------------------------------------------
// workspace.fs stubs — used by filesystem tool handlers.
// Tests that exercise these must configure their return values via vi.mocked().
// ---------------------------------------------------------------------------

export const mockFs = {
  readFile: vi.fn<[{ fsPath: string }], Promise<Uint8Array>>(),
  writeFile: vi.fn<[{ fsPath: string }, Uint8Array], Promise<void>>(),
  createDirectory: vi.fn<[{ fsPath: string }], Promise<void>>(),
  readDirectory: vi.fn<[{ fsPath: string }], Promise<[string, number][]>>(),
  delete: vi.fn<[{ fsPath: string }], Promise<void>>(),
  stat: vi.fn<[{ fsPath: string }], Promise<{ type: number; size: number }>>(),
};

export const mockFindTextInFiles = vi.fn<
  [
    { pattern: string },
    { include?: string; exclude?: string; maxResults?: number },
    (result: {
      uri: { fsPath: string };
      ranges: Array<{ start: { line: number } }>;
    }) => void,
  ],
  Promise<void>
>();

vi.mock("vscode", () => ({
  window: {
    createOutputChannel: vi.fn(() => mockOutputChannel),
    registerWebviewViewProvider: vi.fn(() => mockDisposable),
  },
  commands: {
    registerCommand: vi.fn((_id: string, _handler: () => void) => mockDisposable),
  },
  workspace: {
    getConfiguration: mockGetConfiguration,
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
    fs: mockFs,
    findTextInFiles: mockFindTextInFiles,
    findFiles: vi.fn().mockResolvedValue([]),
    workspaceFolders: [
      { uri: { fsPath: MOCK_WORKSPACE_ROOT }, name: "workspace", index: 0 },
    ],
  },
  Disposable: class {
    dispose = vi.fn();
  },
  EventEmitter: MockEventEmitter,
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, toString: () => `file://${p}` })),
    parse: vi.fn((uri: string) => ({ toString: () => uri })),
    joinPath: vi.fn((base: { fsPath: string }, ...segments: string[]) => {
      const joined = [base.fsPath, ...segments].join("/");
      return { fsPath: joined, toString: () => `file://${joined}` };
    }),
  },
  FileType: {
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
    cancel = vi.fn();
    dispose = vi.fn();
  },
  Position: class {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  },
}));
