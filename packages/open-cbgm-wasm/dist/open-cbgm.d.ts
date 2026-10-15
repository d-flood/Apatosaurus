// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
interface EmbindModule {
  prepare(_0: EmbindString, _1: number, _2: any, _3: boolean, _4: boolean): any;
  computeWitness(_0: EmbindString): any;
  assemble(_0: any): any;
  open(_0: any, _1: any, _2: number): any;
  witnesses(): any;
  units(): any;
  compareWitnesses(_0: EmbindString, _1: any, _2: any): any;
  findRelatives(_0: EmbindString, _1: EmbindString, _2: any, _3: any): any;
  optimizeSubstemmata(_0: EmbindString, _1: number): any;
  textualFlow(_0: EmbindString, _1: EmbindString, _2: any, _3: boolean): any;
  optimizeSubstemma(_0: EmbindString): any;
  writeSubstemmata(_0: any, _1: any): any;
  readSubstemmata(_0: any): any;
  globalStemma(_0: any, _1: boolean, _2: boolean): any;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
