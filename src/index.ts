import { MattermostService } from './services/mattermost.service';

const plugin = {
  name: "mattermost",
  services: [MattermostService]
};

export default plugin; 