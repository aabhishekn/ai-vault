import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    unstubGlobals: true,
  },
})
