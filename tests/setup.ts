import { vi } from "vitest";

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
  },
  Disposable: class {
    dispose = vi.fn();
  },
  EventEmitter: MockEventEmitter,
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path, toString: () => path })),
    parse: vi.fn((uri: string) => ({ toString: () => uri })),
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
    cancel = vi.fn();
    dispose = vi.fn();
  },
}));
