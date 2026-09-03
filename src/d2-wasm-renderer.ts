import {
  D2,
  type CompileRequest,
  type CompileResponse,
  type Diagram,
  type RenderOptions
} from "@d2lang/d2";
import type { D2SourceBundle } from "./vault-d2-sources";

export interface D2Engine {
  compile(input: CompileRequest): Promise<CompileResponse>;
  render(diagram: Diagram, options?: RenderOptions): Promise<string>;
  dispose(): Promise<void>;
}

export type D2EngineFactory = () => D2Engine;

type D2BrowserInternals = D2 & {
  ready?: Promise<void>;
  worker?: Worker;
};

function createD2Engine(): D2Engine {
  const d2 = new D2();
  let disposed = false;

  return {
    compile: (input) => d2.compile(input),
    render: (diagram, options) => d2.render(diagram, options),
    async dispose() {
      if (disposed) return;
      disposed = true;

      // D2.js 0.1.33 does not expose lifecycle methods in its public API.
      // Its pinned browser implementation stores the worker on the instance.
      const internals = d2 as D2BrowserInternals;
      try {
        await internals.ready;
      } finally {
        internals.worker?.terminate();
      }
    }
  };
}

export class WasmD2Renderer {
  private engine: D2Engine | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly loadSources: (
      path: string
    ) => Promise<D2SourceBundle>,
    private readonly createEngine: D2EngineFactory = createD2Engine
  ) {}

  render(path: string): Promise<string> {
    const operation = this.queue.then(async () => {
      const engine = this.engine ??= this.createEngine();
      const { fs, inputPath } = await this.loadSources(path);
      const compiled = await engine.compile({ fs, inputPath, options: {} });
      return engine.render(compiled.diagram, compiled.renderOptions);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  dispose(): Promise<void> {
    if (this.disposePromise !== null) return this.disposePromise;

    this.disposePromise = this.queue.then(async () => {
      if (this.engine === null) return;
      await this.engine.dispose();
    });
    return this.disposePromise;
  }
}
