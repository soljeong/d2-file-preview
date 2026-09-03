export class App {}

export class FileView {
  file: TFile | null = null;

  constructor(public leaf: unknown) {}
}

export class Notice {
  static readonly messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

type RuntimeCommand = {
  id: string;
  name: string;
  callback?: () => unknown;
};

export class Plugin {
  readonly registeredExtensions: Array<{
    extensions: string[];
    viewType: string;
  }> = [];
  readonly commands: RuntimeCommand[] = [];
  readonly registeredEvents: unknown[] = [];
  readonly settingTabs: unknown[] = [];

  constructor(public app: App) {}

  registerExtensions(extensions: string[], viewType: string): void {
    this.registeredExtensions.push({ extensions, viewType });
  }

  addCommand<T extends RuntimeCommand>(command: T): T {
    this.commands.push(command);
    return command;
  }

  registerEvent(eventRef: unknown): void {
    this.registeredEvents.push(eventRef);
  }

}

export class TFile {}
