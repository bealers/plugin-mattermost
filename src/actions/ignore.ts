import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * IGNORE action - Determines when the bot should not respond
 * This prevents the bot from responding to inappropriate messages or when conversation has ended
 */
export const ignoreAction: Action = {
    name: "IGNORE",
    similes: ["SKIP", "NO_RESPONSE", "SILENCE"],
    description: "Ignore messages when response is not appropriate",
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Goodbye!" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "Goodbye! Have a great day!",
                    actions: ["REPLY"]
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Thanks, that's all I needed." }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "",
                    actions: ["IGNORE"]
                }
            }
        ]
    ],

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        // Only validate for Mattermost messages
        const isMattermostMessage = message.content?.source === 'mattermost' || 
                                   message.roomId?.includes('mattermost') ||
                                   message.content?.channelType === 'mattermost';
        
        if (!isMattermostMessage) return false;
        
        // Don't process our own messages
        if (message.userId === runtime.agentId) return false;
        
        const messageText = message.content?.text?.toLowerCase() || '';
        
        // Patterns that suggest we should ignore
        const ignorePatterns = [
            // Conversation endings
            /^(bye|goodbye|see you|talk to you later|ttyl|gotta go|thanks that's all)$/,
            /^(ok thanks|thank you that's all|all good|perfect thanks)$/,
            
            // Short acknowledgments that don't need responses
            /^(ok|okay|k|got it|understood|yep|yeah|sure)$/,
            
            // System or bot messages
            /^(bot|system|automated)/,
            
            // Empty or very short messages
            /^(\.|,|\s*)$/,
            
            // Aggressive or inappropriate content indicators
            /(fuck off|shut up|go away|stop responding)/
        ];
        
        const shouldIgnore = ignorePatterns.some(pattern => pattern.test(messageText));
        
        elizaLogger.debug('IGNORE validation', {
            messageId: message.id,
            messageText,
            shouldIgnore
        });
        
        return shouldIgnore;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            elizaLogger.info('IGNORE action executed - not responding to message', {
                messageId: message.id,
                roomId: message.roomId,
                reason: 'Message matched ignore patterns'
            });
            
            // Call callback with empty response to indicate no action taken
            if (callback) {
                await callback({
                    text: "",
                    source: 'mattermost',
                    actions: ['IGNORE']
                });
            }
            
            return true; // Successfully ignored
        } catch (error) {
            elizaLogger.error('IGNORE action failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id
            });
            return false;
        }
    }
}; 