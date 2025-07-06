import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';

/**
 * Basic Mattermost message response action
 * This handles general message processing and responses
 */
export const mattermostMessageAction: Action = {
    name: "MATTERMOST_MESSAGE",
    similes: ["RESPOND_MESSAGE", "CHAT_RESPONSE", "MESSAGE_REPLY"],
    description: "Respond to messages in Mattermost channels and direct messages",
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Hello, how are you?" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "Hello! I'm doing well, thank you for asking. How can I help you today?",
                    actions: ["MATTERMOST_MESSAGE"]
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "What can you do?" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "I'm an AI assistant integrated with Mattermost. I can help with various tasks, answer questions, and engage in conversations. What would you like assistance with?",
                    actions: ["MATTERMOST_MESSAGE"]
                }
            }
        ]
    ],

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        // Validate this is a Mattermost message that needs a response
        const isMattermostMessage = message.content?.source === 'mattermost' || 
                                   message.roomId?.includes('mattermost') ||
                                   message.content?.channelType === 'mattermost';
        
        // Don't respond to our own messages
        const isOwnMessage = message.userId === runtime.agentId;
        
        // Only process if it's a Mattermost message and not from ourselves
        return isMattermostMessage && !isOwnMessage;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            console.log('🔍 [DEBUG] Mattermost message action triggered');
            console.log('🔍 [DEBUG] Message content:', message.content?.text);
            
            // Get the Mattermost service
            const mattermostService = runtime.getService('mattermost');
            if (!mattermostService) {
                console.log('❌ [ERROR] Mattermost service not available');
                return false;
            }

            // Generate a response using the runtime's AI capabilities
            const responseText = await runtime.generateText({
                context: `You are responding to a message in Mattermost. 
                         User message: "${message.content?.text}"
                         Respond naturally and helpfully.`,
                maxLength: 1000
            });

            console.log('🔍 [DEBUG] Generated response:', responseText);

            // Send the response back to Mattermost
            if (message.roomId) {
                await mattermostService.sendMessage(message.roomId, responseText);
                console.log('✅ [SUCCESS] Response sent to Mattermost');
            }

            // Call the callback if provided (for ElizaOS framework)
            if (callback) {
                await callback({
                    text: responseText,
                    source: 'mattermost',
                    actions: ['MATTERMOST_MESSAGE']
                });
            }

            return true;
        } catch (error) {
            console.log('❌ [ERROR] Failed to process Mattermost message:', error);
            return false;
        }
    }
}; 