export declare class Decrypter {
  constructor(encryptionKey: string | null);
  verifyFakeHeader(header: Uint8Array): boolean;
  decrypt(buffer: ArrayBuffer): ArrayBuffer;
  static getKeyFromPNG(headerLen: number, fileContent: ArrayBuffer): string | null;
}
