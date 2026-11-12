export interface PackagedProject {
  filename: string;
  type: string;
  data: Uint8Array;
}

export interface LoadedProjectHandle {
  promise: Promise<any>;
  terminate(): void;
}

export interface LoadProjectAPI {
  fromID(
    id: string,
    token?: string,
    progressCallback?: (...args: any[]) => void,
  ): Promise<LoadedProjectHandle>;
  fromURL(url: string, progressCallback?: (...args: any[]) => void): Promise<LoadedProjectHandle>;
  fromFile(file: any, progressCallback?: (...args: any[]) => void): Promise<LoadedProjectHandle>;
}

export declare function downloadProject(
  projectData: any,
  progressCallback?: (...args: any[]) => void,
  signal?: AbortSignal,
): Promise<any>;

export declare class Packager {
  constructor();

  project: any;
  options: any;
  aborted: boolean;
  used: boolean;

  abort(): void;
  package(): Promise<PackagedProject>;

  static DEFAULT_OPTIONS(): any;
  static getDefaultPackageNameFromFileName(fileName: string): string;
  static getWindowTitleFromFileName(fileName: string): string;
}

export declare const loadProject: LoadProjectAPI;
export declare const largeAssets: Record<string, any>;

export default Packager;
