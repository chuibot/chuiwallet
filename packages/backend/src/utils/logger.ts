export class Logger {
  private readonly debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
  }

  public log(...messages: unknown[]) {
    if (this.debugMode) console.log(...messages);
  }

  public warn(...messages: unknown[]) {
    if (this.debugMode) console.warn(...messages);
  }

  public error(...messages: unknown[]) {
    if (this.debugMode) console.error(...messages);
  }
}

export const logger = new Logger();
