import { Plugin } from '@elizaos/core';
import { MattermostService } from './services/mattermost.service';

const mattermostPlugin: Plugin = {
  name: "mattermost",
  description: "Mattermost platform integration for ElizaOS",
  services: [MattermostService]
};

export default mattermostPlugin; 