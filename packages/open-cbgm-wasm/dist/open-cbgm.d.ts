// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
interface EmbindModule {
  prepare(_0: EmbindString, _1: number, _2: any, _3: boolean, _4: boolean): any;
  computeWitness(_0: EmbindString): any;
  assemble(_0: any): any;
  open(_0: any, _1: any, _2: number): any;
  compareWitnesses(_0: EmbindString, _1: any): any;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
