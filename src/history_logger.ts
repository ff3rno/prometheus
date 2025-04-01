import { Signale } from 'signale'

export class HistoryLogger {
  private signale: Signale;

  constructor(scope: string) {
    this.signale = new Signale({ scope: `prometheus:${scope}` });
  }

  info(message: string): void {
    this.signale.info(message);
  }

  success(message: string): void {
    this.signale.success(message);
  }

  error(message: string): void {
    this.signale.error(message);
  }

  debug(message: string): void {
    this.signale.debug(message);
  }

  star(message: string): void {
    this.signale.star(message);
  }
  
  warn(message: string): void {
    this.signale.warn(message);
  }
} 