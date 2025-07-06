import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * UPDATE_CONTACT action - Manages user information and relationship building
 * This action learns and stores information about users for better personalization
 */
export const updateContactAction: Action = {
    name: "UPDATE_CONTACT",
    similes: ["LEARN_ABOUT_USER", "STORE_INFO", "REMEMBER_USER"],
    description: "Update contact information and remember details about users",
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "I'm a software engineer at Google" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "That's great! I'll remember that you're a software engineer at Google. What kind of projects do you work on?",
                    actions: ["UPDATE_CONTACT"]
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "My name is Sarah and I prefer to be called Sar" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "Nice to meet you, Sar! I'll remember your preference.",
                    actions: ["UPDATE_CONTACT"]
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
        
        // Patterns that suggest contact information
        const contactPatterns = [
            // Personal information
            /my name is|i'm called|call me/,
            /i work at|i'm at|i'm employed by/,
            /i'm a|i am a|i work as/,
            /my role is|my position is|my job is/,
            /my email is|contact me at/,
            
            // Preferences
            /i prefer|i like to be|please call me/,
            /my timezone is|i'm in/,
            
            // Background information
            /i have experience in|i specialise in|i'm good at/,
            /i've been working|i've worked/,
            /my background is|i come from/
        ];
        
        const hasContactInfo = contactPatterns.some(pattern => pattern.test(messageText));
        
        elizaLogger.debug('UPDATE_CONTACT validation', {
            messageId: message.id,
            hasContactInfo,
            messageText: messageText.substring(0, 100)
        });
        
        return hasContactInfo;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            elizaLogger.debug('Processing UPDATE_CONTACT action', {
                messageId: message.id,
                userId: message.userId
            });
            
            const userMessage = message.content?.text || '';
            const userId = message.userId;
            const senderName = message.content?.metadata?.senderName || 'user';
            
            // Extract information from the message
            const extractedInfo = await runtime.generateText({
                context: `Extract structured information from this user message for contact management.
                
User message: "${userMessage}"
                
Extract:
- Name/preferred name
- Job title/role
- Company/organisation
- Skills/expertise
- Preferences
- Contact information
- Any other relevant personal/professional details

Format as JSON with clear key-value pairs. Only include information explicitly mentioned.`,
                maxLength: 300,
                temperature: 0.3
            });
            
            // Store the contact information (in a real implementation, this would go to a database)
            // For now, we'll log it and acknowledge
            elizaLogger.info('Contact information updated', {
                userId,
                senderName,
                extractedInfo: extractedInfo.substring(0, 200),
                messageId: message.id
            });
            
            // Generate acknowledgment response
            const acknowledgment = await runtime.generateText({
                context: `A user shared personal/professional information: "${userMessage}"
                
Generate a brief, friendly acknowledgment that shows you've noted the information and are interested in learning more about them. Be conversational and encouraging.`,
                maxLength: 150,
                temperature: 0.8
            });
            
            const cleanAcknowledgment = acknowledgment
                .replace(/^\s*["']|["']\s*$/g, '')
                .trim();
            
            // Send acknowledgment if we have a room
            const mattermostService = runtime.getService('mattermost');
            if (mattermostService && message.roomId && cleanAcknowledgment) {
                await mattermostService.sendMessage(message.roomId, cleanAcknowledgment);
                elizaLogger.info('Contact update acknowledgment sent', {
                    roomId: message.roomId,
                    messageId: message.id
                });
            }
            
            // Use callback for framework integration
            if (callback) {
                await callback({
                    text: cleanAcknowledgment,
                    source: 'mattermost',
                    actions: ['UPDATE_CONTACT']
                });
            }
            
            return true;
        } catch (error) {
            elizaLogger.error('UPDATE_CONTACT action failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id
            });
            return false;
        }
    }
}; 