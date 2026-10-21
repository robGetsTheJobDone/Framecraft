// Lexically injected into the package bundle, without mutating window/globalThis.
// Real browser implementations preserve nextTick scheduling and binary codecs.
import process from 'process/browser.js';
import { Buffer } from 'buffer';
const global = globalThis;
export { process, Buffer, global };
