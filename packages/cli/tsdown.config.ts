import { defineConfig } from 'tsdown'

export default defineConfig([
  { entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true },
  { entry: ['src/bin.ts'], format: ['esm'], dts: false },
])
