import yaml from "js-yaml";

export interface StreamState<T = unknown> {
  buffer: string;
  value: T | null;
  valid: boolean;
}

export function appendYamlChunk<T = unknown>(state: StreamState<T>, chunk: string): StreamState<T> {
  const buffer = `${state.buffer}${chunk}`;
  try {
    const value = yaml.load(buffer) as T;
    return { buffer, value, valid: true };
  } catch {
    return { buffer, value: state.value, valid: false };
  }
}

export function createYamlStreamState<T = unknown>(): StreamState<T> {
  return { buffer: "", value: null, valid: false };
}
