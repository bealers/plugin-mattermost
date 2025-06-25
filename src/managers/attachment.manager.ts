import { IAgentRuntime } from '@elizaos/core';
import { RestClient } from '../clients/rest.client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as mime from 'mime-types';

/**
 * Attachment Manager for handling file operations and processing
 * 
 * Provides functionality for:
 * - File download and upload via the RestClient
 * - Processing logic for different file types (images, PDFs, Office documents, text files)
 * - Temporary file management (creation, cleanup)
 * - Error handling and recovery for file operations
 * - File size formatting and limits
 * - Integration with ElizaOS events
 */
export class AttachmentManager {
  private restClient: RestClient;
  private runtime: IAgentRuntime;
  private tempDir: string;
  private isInitialized = false;
  
  constructor(restClient: RestClient, runtime: IAgentRuntime) {
    this.restClient = restClient;
    this.runtime = runtime;
    this.tempDir = path.join(os.tmpdir(), 'mattermost-elizaos-files');
  }
  
  /**
   * Initialize the attachment manager
   * Creates temp directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      // Create temp directory if it doesn't exist
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      this.isInitialized = true;
      this.runtime.logger.info('Attachment manager initialized', {
        tempDir: this.tempDir
      });
    } catch (error) {
      this.runtime.logger.error(`Failed to initialize attachment manager: ${error.message}`);
      throw new Error(`Attachment manager initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Cleanup the attachment manager
   * Removes all temporary files
   */
  async cleanup(): Promise<void> {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.tempDir, file));
          } catch (error) {
            this.runtime.logger.warn(`Error deleting temp file ${file}: ${error.message}`);
          }
        }
      }
      
      this.isInitialized = false;
      this.runtime.logger.info('Attachment manager cleaned up');
    } catch (error) {
      this.runtime.logger.warn(`Error cleaning up temp files: ${error.message}`);
    }
  }
  
  /**
   * Process file attachments from a Mattermost post
   * Downloads files, saves them temporarily, and processes based on type
   */
  async processFileAttachments(fileIds: string[], channelId: string, postId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Attachment manager not initialized');
    }

    if (!fileIds || fileIds.length === 0) {
      return;
    }
    
    this.runtime.logger.info(`Processing ${fileIds.length} file attachments`, {
      fileIds,
      channelId,
      postId
    });
    
    for (const fileId of fileIds) {
      try {
        // Get file info
        const fileInfo = await this.restClient.getFileInfo(fileId);
        
        // Download file
        const fileData = await this.restClient.downloadFile(fileId);
        
        // Save file to temp directory
        const filePath = path.join(this.tempDir, fileInfo.name);
        fs.writeFileSync(filePath, Buffer.from(fileData));
        
        this.runtime.logger.debug(`File saved to temp directory`, {
          fileId,
          filename: fileInfo.name,
          filePath,
          size: fileInfo.size
        });
        
        // Emit file received event for ElizaOS processing
        this.runtime.emit('FILE_RECEIVED', {
          id: fileId,
          name: fileInfo.name,
          path: filePath,
          size: fileInfo.size,
          type: fileInfo.mime_type,
          channelId,
          postId,
        });
        
        // Process file based on type
        await this.processFile(fileInfo, filePath, channelId, postId);
      } catch (error) {
        this.runtime.logger.error(`Error processing file ${fileId}: ${error.message}`);
        
        // Send error message to channel
        try {
          await this.restClient.createPost(
            channelId,
            `Sorry, I encountered an error processing the file: ${error.message}`,
            { rootId: postId }
          );
        } catch (sendError) {
          this.runtime.logger.error(`Error sending error message: ${sendError.message}`);
        }
      }
    }
  }
  
  /**
   * Process a single file based on its type
   * @private
   */
  private async processFile(fileInfo: any, filePath: string, channelId: string, postId: string): Promise<void> {
    // Send processing status message
    await this.restClient.createPost(
      channelId,
      `Processing file: ${fileInfo.name} (${this.formatFileSize(fileInfo.size)})`,
      { rootId: postId }
    );
    
    // Process file based on type
    const mimeType = fileInfo.mime_type || mime.lookup(filePath) || 'application/octet-stream';
    
    this.runtime.logger.debug(`Processing file by type`, {
      filename: fileInfo.name,
      mimeType,
      size: fileInfo.size
    });
    
    if (mimeType.startsWith('image/')) {
      await this.processImage(filePath, channelId, postId, fileInfo);
    } else if (mimeType === 'application/pdf') {
      await this.processPdf(filePath, channelId, postId, fileInfo);
    } else if (mimeType.includes('word') || mimeType.includes('officedocument')) {
      await this.processOfficeDocument(filePath, channelId, postId, fileInfo);
    } else if (mimeType.startsWith('text/')) {
      await this.processTextFile(filePath, channelId, postId, fileInfo);
    } else {
      await this.restClient.createPost(
        channelId,
        `File type ${mimeType} is not supported for processing. I can receive the file but cannot analyze its contents.`,
        { rootId: postId }
      );
    }
  }
  
  /**
   * Process image files
   * @private
   */
  private async processImage(filePath: string, channelId: string, postId: string, fileInfo: any): Promise<void> {
    this.runtime.logger.debug(`Processing image file`, {
      filename: fileInfo.name,
      mimeType: fileInfo.mime_type
    });
    
    // This would integrate with ElizaOS for image analysis
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your image: **${fileInfo.name}**\n\n` +
      `📄 **File Details:**\n` +
      `• Size: ${this.formatFileSize(fileInfo.size)}\n` +
      `• Type: ${fileInfo.mime_type}\n\n` +
      `*This is a placeholder for image analysis. Future versions will include AI-powered image understanding.*`,
      { rootId: postId }
    );
  }
  
  /**
   * Process PDF files
   * @private
   */
  private async processPdf(filePath: string, channelId: string, postId: string, fileInfo: any): Promise<void> {
    this.runtime.logger.debug(`Processing PDF file`, {
      filename: fileInfo.name,
      size: fileInfo.size
    });
    
    // This would integrate with ElizaOS for PDF processing
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your PDF: **${fileInfo.name}**\n\n` +
      `📄 **File Details:**\n` +
      `• Size: ${this.formatFileSize(fileInfo.size)}\n` +
      `• Type: PDF Document\n\n` +
      `*This is a placeholder for PDF analysis. Future versions will include text extraction and document understanding.*`,
      { rootId: postId }
    );
  }
  
  /**
   * Process Office documents (Word, Excel, PowerPoint, etc.)
   * @private
   */
  private async processOfficeDocument(filePath: string, channelId: string, postId: string, fileInfo: any): Promise<void> {
    this.runtime.logger.debug(`Processing Office document`, {
      filename: fileInfo.name,
      mimeType: fileInfo.mime_type
    });
    
    // This would integrate with ElizaOS for Office document processing
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your Office document: **${fileInfo.name}**\n\n` +
      `📄 **File Details:**\n` +
      `• Size: ${this.formatFileSize(fileInfo.size)}\n` +
      `• Type: ${fileInfo.mime_type}\n\n` +
      `*This is a placeholder for Office document analysis. Future versions will include content extraction and document understanding.*`,
      { rootId: postId }
    );
  }
  
  /**
   * Process text files
   * @private
   */
  private async processTextFile(filePath: string, channelId: string, postId: string, fileInfo: any): Promise<void> {
    try {
      this.runtime.logger.debug(`Processing text file`, {
        filename: fileInfo.name,
        size: fileInfo.size
      });
      
      // Read text file content
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // This would integrate with ElizaOS for text analysis
      // For now, return a simple response with file preview
      const preview = content.length > 500 ? content.substring(0, 500) + '...' : content;
      
      await this.restClient.createPost(
        channelId,
        `I've received your text file: **${fileInfo.name}**\n\n` +
        `📄 **File Details:**\n` +
        `• Size: ${this.formatFileSize(fileInfo.size)}\n` +
        `• Lines: ${content.split('\n').length}\n` +
        `• Characters: ${content.length}\n\n` +
        `**Preview:**\n\`\`\`\n${preview}\n\`\`\`\n\n` +
        `*This is a placeholder for text analysis. Future versions will include AI-powered content analysis.*`,
        { rootId: postId }
      );
    } catch (error) {
      this.runtime.logger.error(`Error reading text file: ${error.message}`);
      await this.restClient.createPost(
        channelId,
        `I received the text file **${fileInfo.name}** but encountered an error reading its contents: ${error.message}`,
        { rootId: postId }
      );
    }
  }
  
  /**
   * Upload a file to Mattermost
   */
  async uploadFile(channelId: string, fileData: Buffer, fileName: string, postId?: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Attachment manager not initialized');
    }

    try {
      this.runtime.logger.debug(`Uploading file`, {
        channelId,
        fileName,
        fileSize: fileData.length
      });
      
      // Upload file to Mattermost
      const fileInfo = await this.restClient.uploadFile(channelId, fileData, fileName);
      
      // Post message with file attachment
      const message = `Here's the file: **${fileName}** (${this.formatFileSize(fileData.length)})`;
      await this.restClient.createPost(channelId, message, { 
        rootId: postId,
        fileIds: [fileInfo.file_infos[0].id]
      });
      
      this.runtime.logger.info(`File uploaded successfully`, {
        channelId,
        fileName,
        fileId: fileInfo.file_infos[0].id
      });
      
      return fileInfo.file_infos[0].id;
    } catch (error) {
      this.runtime.logger.error(`Error uploading file: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Format file size in human-readable format
   * @private
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  /**
   * Check if the attachment manager is ready for use
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get the temporary directory path
   */
  get tempDirectory(): string {
    return this.tempDir;
  }
} 