/**
 * Mattermost-specific actions for ElizaOS
 */

// Core conversation actions
import { replyAction } from './reply';
import { ignoreAction } from './ignore';
import { updateContactAction } from './update-contact';
import { continueAction } from './continue';


// CHECK-ME: Legacy action - keeping for backward compatibility but using cleaner implementation
import { mattermostMessageAction } from './message-response';

// Re-export individual actions
export { replyAction, ignoreAction, updateContactAction, continueAction, mattermostMessageAction };

// Export array for easy plugin registration
export const mattermostActions = [
    replyAction,
    ignoreAction,
    updateContactAction,
    continueAction,
    mattermostMessageAction
]; 