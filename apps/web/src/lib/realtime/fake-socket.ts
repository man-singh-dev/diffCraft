import { EventEmitter } from 'node:events';
import type { RealtimeSocket } from './connection';

type AnyListener = (...args: unknown[]) => void;

export class FakeSocket implements RealtimeSocket {
  private readonly listeners = new EventEmitter();
  connected = false;
  active = true;
  sent: { event: string; args: unknown[] }[] = [];
  connectCalls = 0;
  disconnectCalls = 0;

  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.on(event, listener as AnyListener);
    return this;
  }

  off(event: string, listener: (...args: never[]) => void) {
    this.listeners.off(event, listener as AnyListener);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.sent.push({ event, args });
    return this;
  }

  connect() {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.active = false;
    this.connected = false;
    return this;
  }

  listenerCount(event: string) {
    return this.listeners.listenerCount(event);
  }

  receive(event: string, ...args: unknown[]) {
    this.listeners.emit(event, ...args);
  }

  serverConnect() {
    this.connected = true;
    this.active = true;
    this.receive('connect');
  }

  transportDrop() {
    this.connected = false;
    this.receive('disconnect', 'transport close');
  }

  refuse() {
    this.connected = false;
    this.active = false;
    this.receive('connect_error', new Error('unauthorized'));
  }

  sentEvents(event: string) {
    return this.sent.filter((s) => s.event === event);
  }

  ack(event: string, index: number, response: unknown) {
    const call = this.sentEvents(event)[index];
    if (!call) throw new Error(`no ${event} #${index}`);
    (call.args.at(-1) as (response: unknown) => void)(response);
  }
}
