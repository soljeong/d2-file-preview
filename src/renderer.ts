export function svgPathForD2(d2Path: string): string {
  return d2Path.replace(/\.d2$/, ".svg");
}

type RenderState = {
  timer?: ReturnType<typeof setTimeout>;
  rendering: boolean;
  rerenderRequested: boolean;
};

type RenderSchedulerOptions = {
  delayMs: number;
  render: (path: string) => Promise<void>;
};

export class RenderScheduler {
  private readonly delayMs: number;
  private readonly render: (path: string) => Promise<void>;
  private readonly states = new Map<string, RenderState>();

  constructor({ delayMs, render }: RenderSchedulerOptions) {
    this.delayMs = delayMs;
    this.render = render;
  }

  schedule(path: string): void {
    const state = this.states.get(path) ?? {
      rendering: false,
      rerenderRequested: false
    };
    this.states.set(path, state);

    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.onTimer(path, state);
    }, this.delayMs);
  }

  dispose(): void {
    for (const state of this.states.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.timer = undefined;
      state.rerenderRequested = false;
    }
    this.states.clear();
  }

  private onTimer(path: string, state: RenderState): void {
    if (state.rendering) {
      state.rerenderRequested = true;
      return;
    }

    void this.renderPath(path, state);
  }

  private async renderPath(path: string, state: RenderState): Promise<void> {
    state.rendering = true;

    try {
      await this.render(path);
    } catch {
      // Rendering failures are reported by the callback that owns the render.
    }

    state.rendering = false;

    if (state.rerenderRequested) {
      state.rerenderRequested = false;
      if (state.timer === undefined && this.states.get(path) === state) {
        void this.renderPath(path, state);
        return;
      }
    }

    if (state.timer === undefined && this.states.get(path) === state) {
      this.states.delete(path);
    }
  }
}
