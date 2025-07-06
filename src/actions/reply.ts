import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * REPLY action - Handles natural conversational responses
 * This is the primary action for general conversation
 */
export const replyAction: Action = {
    name: "REPLY",
    similes: ["RESPOND", "ANSWER", "CHAT"],
    description: "Reply to messages with natural conversation",
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "How's your day going?" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "It's going well, thank you! I've been helping people with various tasks. How about yours?",
                    actions: ["REPLY"]
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Can you help me with something?" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "Of course! I'd be happy to help. What do you need assistance with?",
                    actions: ["REPLY"]
                }
            }
        ]
    ],

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        // This is the default reply action - validate for most Mattermost messages
        const isMattermostMessage = message.content?.source === 'mattermost' || 
                                   message.roomId?.includes('mattermost') ||
                                   message.content?.channelType === 'mattermost';
        
        // Don't respond to our own messages
        const isOwnMessage = message.userId === runtime.agentId;
        
        // Basic validation for reply-worthy content
        const hasContent = message.content?.text && message.content.text.trim().length > 0;
        
        return isMattermostMessage && !isOwnMessage && hasContent;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            elizaLogger.debug('Processing REPLY action', {
                messageId: message.id,
                roomId: message.roomId
            });
            
            const mattermostService = runtime.getService('mattermost');
            if (!mattermostService) {
                elizaLogger.error('Mattermost service not available for REPLY action');
                return false;
            }

            // Extract context for natural replies
            const userMessage = message.content?.text || '';
            const isDirectMessage = message.content?.metadata?.isDirectMessage || false;
            const senderName = message.content?.metadata?.senderName || 'user';
            const channelName = message.content?.metadata?.channelName || 'channel';
            
            // Create context for natural conversation
            let conversationContext = '';
            if (isDirectMessage) {
                conversationContext = `You are having a natural conversation with ${senderName} in a private message. Be friendly, helpful, and engaging.`;
            } else {
                conversationContext = `You are participating in a conversation in the ${channelName} channel. Be helpful and appropriate for the team environment.`;
            }
            
            // Generate natural reply
            const replyText = await runtime.generateText({
                context: `${conversationContext}\n\nUser message: "${userMessage}"\n\nRespond naturally and helpfully. Keep your response concise and conversational.`,
                maxLength: 400,
                temperature: 0.8
            });

            // Clean the response
            const cleanReply = replyText
                .replace(/^\s*["']|["']\s*$/g, '') // Remove quotes
                .trim();

            if (cleanReply && message.roomId) {
                await mattermostService.sendMessage(message.roomId, cleanReply);
                elizaLogger.info('REPLY sent successfully', {
                    roomId: message.roomId,
                    messageId: message.id
                });
            }

            // Use callback for framework integration
            if (callback) {
                await callback({
                    text: cleanReply,
                    source: 'mattermost',
                    actions: ['REPLY']
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('REPLY action failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id
            });
            return false;
        }
    }
}; 