export declare class SimpleTTS {
  onReady(callback: () => void): void;
  speak(text: string, callback: (audio: Float32Array, sampleRate: number) => void): void;
  constructor(options: any);
}
