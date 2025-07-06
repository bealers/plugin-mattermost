import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * Sanitize response to remove any debug information or unwanted patterns
 */
function sanitizeResponse(response: string): string {
    if (!response) return '';
    
    return response
        .replace(/\[DEBUG\].*$/gm, '')
        .replace(/console\.log\(.*\)/g, '')
        .replace(/🔍|✅|❌/g, '')
        .replace(/\[ERROR\].*$/gm, '')
        .replace(/\[SUCCESS\].*$/gm, '')
        .replace(/Possible response actions:.*$/gm, '')
        .replace(/Available Actions.*$/gm, '')
        .replace(/Action Examples.*$/gm, '')
        .replace(/undefined:/g, '')
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

/**
 * Generate user-friendly fallback response when AI generation fails
 */
function generateFallbackResponse(metadata: {
    isDirectMessage: boolean;
    senderName?: string;
}): string {
    if (metadata.isDirectMessage) {
        return `Hi${metadata.senderName ? ` ${metadata.senderName}` : ''}! I received your message, but I'm having trouble generating a response right now. Could you try rephrasing your question?`;
    } else {
        return "I'm following this discussion, but I'm having trouble generating a response at the moment. Please try again!";
    }
}

/**
 * Validate response quality to ensure it meets standards
 */
function validateResponse(response: string): boolean {
    // Check for minimum length
    if (response.length < 5) return false;
    
    // Check for common error patterns that shouldn't reach users
    const errorPatterns = [
        'I don\'t know how to',
        'I cannot access',
        'As an AI language model',
        'undefined',
        'null',
        '[object Object]',
        'console.log',
        'DEBUG',
        'ERROR'
    ];
    
    const lowerResponse = response.toLowerCase();
    return !errorPatterns.some(pattern => lowerResponse.includes(pattern.toLowerCase()));
}

/**
 * Basic Mattermost message response action
 * This handles general message processing and responses with clean output
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
            elizaLogger.debug('Processing Mattermost message', {
                messageId: message.id,
                roomId: message.roomId,
                hasContent: !!message.content?.text
            });
            
            // Get the Mattermost service
            const mattermostService = runtime.getService('mattermost');
            if (!mattermostService) {
                elizaLogger.error('Mattermost service not available');
                return false;
            }

            // Extract message context
            const userMessage = message.content?.text || '';
            const isDirectMessage = message.content?.metadata?.isDirectMessage || false;
            const channelName = message.content?.metadata?.channelName || 'a channel';
            const senderName = message.content?.metadata?.senderName || 'user';
            
            // Create context-appropriate prompt
            let contextPrompt = '';
            if (isDirectMessage) {
                contextPrompt = `You are having a friendly private conversation with ${senderName}. Respond naturally and helpfully.`;
            } else {
                contextPrompt = `You are participating in the ${channelName} team channel. Respond appropriately for a public channel discussion.`;
            }
            
            // Generate response with clean context
            const responseText = await runtime.generateText({
                context: `${contextPrompt}\n\nUser message: "${userMessage}"\n\nRespond naturally and conversationally.`,
                maxLength: 500,
                temperature: 0.7,
                stop: ['\\n\\nUser:', '\\n\\nHuman:', '<|endoftext|>']
            });

            // Sanitize and validate the response
            const sanitizedResponse = sanitizeResponse(responseText);
            
            elizaLogger.debug('Generated response', {
                originalLength: responseText.length,
                sanitizedLength: sanitizedResponse.length,
                messageId: message.id
            });

            // Validate response quality
            let finalResponse = sanitizedResponse;
            if (!validateResponse(sanitizedResponse)) {
                elizaLogger.warn('Generated response failed validation, using fallback', {
                    messageId: message.id,
                    originalResponse: sanitizedResponse
                });
                finalResponse = generateFallbackResponse({ isDirectMessage, senderName });
            }

            // Send the response to Mattermost
            if (message.roomId && finalResponse) {
                await mattermostService.sendMessage(message.roomId, finalResponse);
                elizaLogger.info('Response sent to Mattermost', {
                    roomId: message.roomId,
                    messageId: message.id,
                    responseLength: finalResponse.length
                });
            }

            // Call the callback for ElizaOS framework integration
            if (callback) {
                await callback({
                    text: finalResponse,
                    source: 'mattermost',
                    actions: ['MATTERMOST_MESSAGE']
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('Failed to process Mattermost message', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id,
                roomId: message.roomId
            });
            
            // Provide user-friendly error message via callback
            if (callback) {
                const errorMessage = generateFallbackResponse({
                    isDirectMessage: message.content?.metadata?.isDirectMessage || false,
                    senderName: message.content?.metadata?.senderName
                });
                
                await callback({
                    text: errorMessage,
                    source: 'mattermost',
                    actions: ['MATTERMOST_MESSAGE']
                });
            }
            
            return false;
        }
    }
}; 