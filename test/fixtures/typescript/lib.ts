export interface Options {
  size: number;
}

export const area = (options: Options): number => options.size * options.size;
