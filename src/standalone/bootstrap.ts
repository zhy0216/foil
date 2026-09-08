import { Buffer } from 'buffer';

// Built as a separate IIFE and physically prepended to the reading program.
// inlineDynamicImports can evaluate tlock's dependencies before any await.
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
