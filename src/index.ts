import { MattermostService } from './services/mattermost.service';
import { mattermostActions } from './actions';
import type { Plugin } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

elizaLogger.debug('Plugin index.ts loading', {
    serviceAvailable: !!MattermostService,
    actionsCount: mattermostActions.length
});

// The good stuff
const mattermostPlugin: Plugin = {
  name: "mattermost",
  description: "Fully featured Mattermost client for elizaOS",
  services: [MattermostService],
  actions: mattermostActions, // All core actions: REPLY, IGNORE, UPDATE_CONTACT, CONTINUE, MATTERMOST_MESSAGE
  providers: [], // Context providers can be added later
  evaluators: [], // Evaluators can be added later
};

elizaLogger.info('Mattermost plugin configured', {
    name: mattermostPlugin.name,
    servicesCount: mattermostPlugin.services.length,
    actionsCount: mattermostPlugin.actions.length,
    actionNames: mattermostPlugin.actions.map(action => action.name)
});

// Export the plugin object directly
export default mattermostPlugin; 