import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from '@elizaos/core';
import { elizaLogger } from '@elizaos/core';

/**
 * CONTINUE action - Extends conversations with follow-up questions or elaboration
 */
export const continueAction: Action = {
    name: "CONTINUE",
    similes: ["FOLLOW_UP", "ELABORATE", "ASK_MORE"],
    description: "Continue conversations with follow-up questions or elaboration",
    
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "I just finished a project at work" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "That's great! What kind of project was it? How did it go?",
                    actions: ["CONTINUE"]
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "I'm learning Python" }
            },
            {
                user: "{{agent}}",
                content: { 
                    text: "Cool, excellent choice! How are you finding it so far?",
                    actions: ["CONTINUE"]
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
        
        // Patterns that suggest the conversation could be extended
        const continuePatterns = [
            // Statements that invite follow-up
            /i just|i've been|i'm working on|i'm learning/,
            /i finished|i completed|i started/,
            /i think|i believe|i feel like/,
            /i'm trying to|i want to|i hope to/,
            /i had|i went|i saw|i met/,
            
            // Topics that naturally invite elaboration
            /project|work|study|course|book|movie|trip/,
            /problem|issue|challenge|opportunity/,
            /excited|worried|confused|interested/,
            
            // Learning and development mentions
            /learning|studying|practicing|working on/,
            /new to|beginner|getting started/
        ];
        
        const shouldContinue = continuePatterns.some(pattern => pattern.test(messageText));
        
        // Don't continue if the message is too short or already a question
        const isQuestion = messageText.includes('?');
        const isVeryShort = messageText.length < 10;
        
        const finalDecision = shouldContinue && !isQuestion && !isVeryShort;
        
        elizaLogger.debug('CONTINUE validation', {
            messageId: message.id,
            shouldContinue,
            isQuestion,
            isVeryShort,
            finalDecision,
            messageText: messageText.substring(0, 100)
        });
        
        return finalDecision;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            elizaLogger.debug('Processing CONTINUE action', {
                messageId: message.id,
                roomId: message.roomId
            });
            
            const mattermostService = runtime.getService('mattermost');
            if (!mattermostService) {
                elizaLogger.error('Mattermost service not available for CONTINUE action');
                return false;
            }

            const userMessage = message.content?.text || '';
            const isDirectMessage = message.content?.metadata?.isDirectMessage || false;
            const senderName = message.content?.metadata?.senderName || 'user';
            
            // Generate follow-up questions or elaboration
            let conversationContext = '';
            if (isDirectMessage) {
                conversationContext = `You are having a personal conversation with ${senderName}. Show genuine interest in what they're sharing.`;
            } else {
                conversationContext = `You are participating in a team channel discussion. Show professional interest and engagement.`;
            }
            
            const followUp = await runtime.generateText({
                context: `${conversationContext}

User just said: "${userMessage}"

Generate 1-2 thoughtful follow-up questions or show interest in what they shared. Be curious and encouraging. Ask about:
- Details about what they mentioned
- Their experience or feelings about it
- Next steps or plans
- How they're finding it

Keep it natural and conversational.`,
                maxLength: 200,
                temperature: 0.8
            });
            
            const cleanFollowUp = followUp
                .replace(/^\s*["']|["']\s*$/g, '')
                .trim();

            if (cleanFollowUp && message.roomId) {
                await mattermostService.sendMessage(message.roomId, cleanFollowUp);
                elizaLogger.info('CONTINUE response sent', {
                    roomId: message.roomId,
                    messageId: message.id,
                    responseLength: cleanFollowUp.length
                });
            }

            // Use callback for framework integration
            if (callback) {
                await callback({
                    text: cleanFollowUp,
                    source: 'mattermost',
                    actions: ['CONTINUE']
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error('CONTINUE action failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                messageId: message.id
            });
            return false;
        }
    }
}; 