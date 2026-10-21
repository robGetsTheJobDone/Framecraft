import {defineConfig, loadEnv} from 'vite';
import {fileURLToPath} from 'node:url';
import {openAIHandler} from './server.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({mode}) => {
  const env = {...loadEnv(mode, root, 'OPENAI_'), ...process.env};
  return {plugins: [{name: 'studio-openai', configureServer(server) {server.middlewares.use(openAIHandler(env));}, configurePreviewServer(server) {server.middlewares.use(openAIHandler(env));}}]};
});
