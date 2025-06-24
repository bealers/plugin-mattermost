import { MattermostService } from './services/mattermost.service';
import pkg from '../package.json';

// Extract agentConfig from package.json
const config = pkg.agentConfig?.pluginParameters || {};

// Minimal model stubs
const models = {
  TEXT_SMALL: async (_runtime: unknown, { prompt }: { prompt: string }) => `Echo: ${prompt}`,
  TEXT_LARGE: async (_runtime: unknown, { prompt }: { prompt: string }) => `Echo: ${prompt}`,
};

// Minimal action stub
const actions = [
  {
    name: 'echo',
    description: 'Echoes the input',
    handler: async (_runtime: unknown, { text }: { text: string }) => text,
  },
];

// Plugin init function
async function init(settings: unknown, runtime: { logger?: { info?: (...args: unknown[]) => void } }) {
  if (runtime.logger && typeof runtime.logger.info === 'function') {
    runtime.logger.info('Initializing Mattermost plugin with settings:', settings);
  } else {
    console.info('Initializing Mattermost plugin with settings:', settings);
  }
  // Any additional setup can go here
}

const mattermostPlugin = {
  name: 'plugin-mattermost-client',
  description: 'Mattermost client plugin for ElizaOS - enables AI agent integration with Mattermost chat platforms',
  config,
  init,
  models,
  actions,
  services: [MattermostService],
};

export default mattermostPlugin;
export { MattermostService }; 