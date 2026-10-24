import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The page imports shared/addresses*.json and shared/abi/*.json from the repo root.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
})
