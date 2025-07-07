import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * REPLY action - primary action for general conversation
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
    ] as any,

    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        elizaLogger.debug('REPLY action validation called', {
            messageId: message.id,
            hasContent: !!message.content,
            contentText: message.content?.text,
            source: message.content?.source,
            metadata: message.content?.metadata,
            entityId: message.entityId,
            agentId: runtime.agentId
        });

        elizaLogger.debug('REPLY action validation', {
            messageId: message.id,
            source: message.content?.source,
            platform: (message.content?.metadata as any)?.platform,
            hasText: !!message.content?.text,
            entityId: message.entityId,
            agentId: runtime.agentId
        });

        // Check if this is a Mattermost message
        const isMattermostMessage = message.content?.source === 'mattermost' || 
                                   (message.content?.metadata as any)?.platform === 'mattermost' ||
                                   message.roomId?.includes('mattermost');
        
        // Don't respond to our own messages - fix: check if this message came from the agent
        // In Mattermost, the entityId represents the sender, and we shouldn't respond to our own messages
        const isOwnMessage = message.entityId === runtime.agentId || 
                           message.agentId === runtime.agentId ||
                           (message.content?.metadata as any)?.isFromAgent === true;
        
        // Basic validation for reply-worthy content
        const hasContent = message.content?.text && message.content.text.trim().length > 0;
        
        const isValid = isMattermostMessage && !isOwnMessage && hasContent;
        
        elizaLogger.debug('REPLY validation result', {
            isMattermostMessage,
            isOwnMessage,
            hasContent,
            isValid,
            entityId: message.entityId,
            agentId: runtime.agentId,
            messageAgentId: message.agentId
        });
        
        elizaLogger.debug('REPLY validation result', {
            messageId: message.id,
            isMattermostMessage,
            isOwnMessage,
            hasContent,
            isValid
        });
        
        return isValid;
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
                roomId: message.roomId,
                hasState: !!state,
                stateLength: state?.text?.length || 0
            });

            // Extract context for natural replies
            const userMessage = message.content?.text || '';
            const metadata = message.content?.metadata as any;
            const isDirectMessage = metadata?.isDirectMessage || false;
            const senderName = metadata?.senderName || 'user';
            const channelName = metadata?.channelName || 'channel';
            
            // Use the composed state which includes character context
            // The state already contains the character's personality, bio, and system prompt
            const contextualPrompt = state?.text || '';
            
            elizaLogger.debug('REPLY context preparation', {
                messageId: message.id,
                userMessage: userMessage.substring(0, 100),
                contextLength: contextualPrompt.length,
                isDirectMessage,
                senderName,
                channelName
            });
            
            // Create a natural conversation prompt that preserves character context
            let conversationPrompt = '';
            if (contextualPrompt.trim()) {
                // Use the composed state which includes character context
                conversationPrompt = `${contextualPrompt}\n\n`;
            }
            
            // Add conversation context
            if (isDirectMessage) {
                conversationPrompt += `You are having a natural conversation with ${senderName} in a private message.\n`;
            } else {
                conversationPrompt += `You are participating in a conversation in the ${channelName} channel.\n`;
            }
            
            conversationPrompt += `User message: "${userMessage}"\n\nRespond naturally and helpfully according to your character. Keep your response concise and conversational.`;
            
            // Generate natural reply using character context
            const replyText = await runtime.useModel('TEXT_LARGE', {
                prompt: conversationPrompt,
                max_tokens: 400,
                temperature: 0.8
            });

            // Clean the response
            const cleanReply = replyText
                .replace(/^\s*["']|["']\s*$/g, '') // Remove quotes
                .replace(/^(Assistant:|AI:|Bot:)\s*/i, '') // Remove AI prefixes
                .trim();

            elizaLogger.debug('REPLY generated', {
                messageId: message.id,
                originalLength: replyText.length,
                cleanedLength: cleanReply.length,
                reply: cleanReply.substring(0, 100)
            });

            // Use callback for framework integration
            if (callback && cleanReply) {
                await callback({
                    text: cleanReply,
                    source: 'mattermost',
                    actions: ['REPLY']
                });
                
                elizaLogger.info('REPLY sent successfully', {
                    roomId: message.roomId,
                    messageId: message.id,
                    responseLength: cleanReply.length
                });
                
                return true;
            } else {
                elizaLogger.warn('REPLY failed - no callback or empty response', {
                    messageId: message.id,
                    hasCallback: !!callback,
                    hasReply: !!cleanReply
                });
                return false;
            }

        } catch (error) {
            elizaLogger.error('REPLY action failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id,
                stack: error instanceof Error ? error.stack : undefined
            });
            return false;
        }
    }
}; 