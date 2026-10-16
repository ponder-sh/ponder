// `?arraybuffer` imports are handled by `vite-plugin-arraybuffer`, which Vocs registers.
declare module "*?arraybuffer" {
  const data: ArrayBuffer;
  export default data;
}
