import type { WaveFile } from "node_modules/wavefile";

export type TypedWaveFile = Omit<WaveFile, "getSamples"> & {
  fmt: {
    sampleRate: number;
    numChannels: number;
    blockAlign: number;
  };
  data: {
    samples: Uint8Array;
  };
  getSamples<T>(interleaved: true, OutputObject: new (length: number) => T): T;
  getSamples<T>(interleaved: boolean, OutputObject: new (length: number) => T): T | T[];
};
