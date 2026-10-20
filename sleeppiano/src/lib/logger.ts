import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  ts: string;
  level: LogLevel;
  step: string;
  message: string;
}

/** Anything that looks like a credential, so a stray interpolation cannot leak one. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /"token"\s*:\s*"[^"]+"/gi,
];

export function redact(message: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '<redacted>'), message);
}

/**
 * The run log. Lines fan out three ways: the console, `logs/run.log` inside the
 * run folder, and every connected SSE client.
 */
export class RunLogger extends EventEmitter {
  private readonly buffer: LogLine[] = [];
  private fileStream: fs.WriteStream | null = null;
  private currentStep = 'IDLE';

  /** Bounded so a long-lived server cannot grow without limit. */
  private static readonly MAX_BUFFERED = 2000;

  attachFile(logFilePath: string): void {
    this.detachFile();
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    this.fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  }

  detachFile(): void {
    this.fileStream?.end();
    this.fileStream = null;
  }

  setStep(step: string): void {
    this.currentStep = step;
  }

  log(message: string, level: LogLevel = 'info', step = this.currentStep): void {
    const line: LogLine = {
      ts: new Date().toISOString(),
      level,
      step,
      message: redact(message),
    };

    this.buffer.push(line);
    if (this.buffer.length > RunLogger.MAX_BUFFERED) {
      this.buffer.splice(0, this.buffer.length - RunLogger.MAX_BUFFERED);
    }

    const rendered = `[${line.ts}] [${line.step}] ${line.message}`;
    if (level === 'error') console.error(rendered);
    else if (level === 'warn') console.warn(rendered);
    else console.log(rendered);

    this.fileStream?.write(`${rendered}\n`);
    this.emit('line', line);
  }

  info(message: string, step?: string): void {
    this.log(message, 'info', step);
  }

  warn(message: string, step?: string): void {
    this.log(message, 'warn', step);
  }

  error(message: string, step?: string): void {
    this.log(message, 'error', step);
  }

  recent(limit = 500): LogLine[] {
    return this.buffer.slice(-limit);
  }
}

export const runLogger = new RunLogger();
