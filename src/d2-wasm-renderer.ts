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
  let workerTerminated = false;

  const terminateWorker = (): void => {
    if (workerTerminated) return;
    const worker = (d2 as D2BrowserInternals).worker;
    if (worker === undefined) return;
    workerTerminated = true;
    worker.terminate();
  };

  return {
    compile: (input) => d2.compile(input),
    render: (diagram, options) => d2.render(diagram, options),
    async dispose() {
      if (disposed) return;
      disposed = true;

      // D2.js 0.1.33 does not expose lifecycle methods in its public API.
      // Its pinned browser implementation stores the worker on the instance.
      const internals = d2 as D2BrowserInternals;
      terminateWorker();
      await Promise.resolve();
      terminateWorker();
      void internals.ready?.then(terminateWorker, terminateWorker);
    }
  };
}

const DISPOSED_MESSAGE = "D2 renderer has been disposed";

export class WasmD2Renderer {
  private engine: D2Engine | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposePromise: Promise<void> | null = null;
  private readonly disposeController = new AbortController();
  private disposed = false;

  constructor(
    private readonly loadSources: (
      path: string
    ) => Promise<D2SourceBundle>,
    private readonly createEngine: D2EngineFactory = createD2Engine
  ) {}

  render(path: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED_MESSAGE));

    const operation = this.raceWithDisposal(
      this.queue.then(() => this.performRender(path))
    );
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  dispose(): Promise<void> {
    if (this.disposePromise !== null) return this.disposePromise;

    this.disposed = true;
    this.disposeController.abort();
    this.disposePromise = this.engine?.dispose() ?? Promise.resolve();
    return this.disposePromise;
  }

  private async performRender(path: string): Promise<string> {
    this.throwIfDisposed();
    const engine = this.engine ??= this.createEngine();
    const { fs, inputPath } = await this.loadSources(path);
    this.throwIfDisposed();
    const compiled = await engine.compile({ fs, inputPath, options: {} });
    this.throwIfDisposed();
    return engine.render(compiled.diagram, compiled.renderOptions);
  }

  private raceWithDisposal<T>(operation: Promise<T>): Promise<T> {
    const signal = this.disposeController.signal;
    return new Promise<T>((resolve, reject) => {
      const onDispose = (): void => reject(new Error(DISPOSED_MESSAGE));
      if (signal.aborted) {
        onDispose();
        return;
      }

      signal.addEventListener("abort", onDispose, { once: true });
      void operation.then(
        (value) => {
          signal.removeEventListener("abort", onDispose);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onDispose);
          reject(error);
        }
      );
    });
  }

  private throwIfDisposed(): void {
    if (this.disposed) throw new Error(DISPOSED_MESSAGE);
  }
}
