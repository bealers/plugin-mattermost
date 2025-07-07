import { IAgentRuntime, elizaLogger } from '@elizaos/core';
import { RestClient } from '../clients/rest.client';
import { createSafeLogger } from '../config/credentials';
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
  private logger = createSafeLogger(elizaLogger);
  
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
      this.logger.info('Attachment manager initialized', {
        tempDir: this.tempDir
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to initialize attachment manager`, err);
      throw new Error(`Attachment manager initialization failed: ${err.message}`);
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
            this.logger.warn(`Error deleting temp file ${file}: ${error.message}`);
          }
        }
      }
      
      this.isInitialized = false;
      this.logger.info('Attachment manager cleaned up');
    } catch (error) {
      this.logger.warn(`Error cleaning up temp files: ${error.message}`);
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
    
    this.logger.info(`Processing ${fileIds.length} file attachments`, {
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
        
        this.logger.debug(`File saved to temp directory`, {
          fileId,
          filename: fileInfo.name,
          filePath,
          size: fileInfo.size
        });
        
        // TODO-NEXT: Emit file received event for elizaOS processing
        // this.runtime.emit('FILE_RECEIVED', {
        //   id: fileId,
        //   name: fileInfo.name,
        //   path: filePath,
        //   size: fileInfo.size,
        //   type: fileInfo.mime_type,
        //   channelId,
        //   postId,
        // });
        
        // Process file based on type
        await this.processFile(fileInfo, filePath, channelId, postId);
      } catch (error) {
        this.logger.error(`Error processing file ${fileId}: ${error.message}`);
        
        // Send error message to channel
        try {
          await this.restClient.createPost(
            channelId,
            `Sorry, I encountered an error processing the file: ${error.message}`,
            { rootId: postId }
          );
        } catch (sendError) {
          this.logger.error(`Error sending error message: ${sendError.message}`);
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
    
    this.logger.debug(`Processing file by type`, {
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
    this.logger.debug(`Processing image file`, {
      filename: fileInfo.name,
      mimeType: fileInfo.mime_type
    });
    
    // This would integrate with ElizaOS for image analysis
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your image: **${fileInfo.name}**\n\n` +
      `**File Details:**\n` +
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
    this.logger.debug(`Processing PDF file`, {
      filename: fileInfo.name,
      size: fileInfo.size
    });
    
    // This would integrate with ElizaOS for PDF processing
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your PDF: **${fileInfo.name}**\n\n` +
      `**File Details:**\n` +
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
    this.logger.debug(`Processing Office document`, {
      filename: fileInfo.name,
      mimeType: fileInfo.mime_type
    });
    
    // This would integrate with ElizaOS for Office document processing
    // For now, return a simple response
    await this.restClient.createPost(
      channelId,
      `I've received your Office document: **${fileInfo.name}**\n\n` +
      `**File Details:**\n` +
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
      this.logger.debug(`Processing text file`, {
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
        `**File Details:**\n` +
        `• Size: ${this.formatFileSize(fileInfo.size)}\n` +
        `• Lines: ${content.split('\n').length}\n` +
        `• Characters: ${content.length}\n\n` +
        `**Preview:**\n\`\`\`\n${preview}\n\`\`\`\n\n` +
        `*This is a placeholder for text analysis. Future versions will include AI-powered content analysis.*`,
        { rootId: postId }
      );
    } catch (error) {
      this.logger.error('Error reading text file', error);
      await this.restClient.createPost(
        channelId,
        `I received the text file **${fileInfo.name}** but encountered an error reading its contents: ${error.message}`,
        { rootId: postId }
      );
    }
  }
  
  /**
   * Upload a file to Mattermost and post a message with the attachment
   */
  async uploadFile(channelId: string, fileData: Buffer, fileName: string, postId?: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Attachment manager not initialized');
    }
    
    try {
      this.logger.debug(`Uploading file`, {
        channelId,
        fileName,
        fileSize: fileData.length
      });
      
      // Upload file to Mattermost
      const uploadResult = await this.restClient.uploadFile(channelId, fileData, fileName);
      
      const fileId = uploadResult.file_infos[0].id;
      
      this.logger.info(`File uploaded successfully`, {
        channelId,
        fileName,
        fileId
      });
      
      return fileId;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate and upload a text file to Mattermost
   */
  async generateAndUploadTextFile(channelId: string, content: string, fileName: string, postId?: string): Promise<string> {
    try {
      this.logger.info('Generating and uploading text file', { 
        fileName, 
        contentLength: content.length,
        channelId 
      });
      
      // Create file buffer
      const fileData = Buffer.from(content, 'utf-8');
      
      // Upload file
      const fileId = await this.uploadFile(channelId, fileData, fileName, postId);
      
      // Post message with file attachment
      await this.restClient.createPost(channelId, `Generated file: ${fileName}`, {
        rootId: postId,
        fileIds: [fileId]
      });
      
      this.logger.info('Text file generated and uploaded successfully', { 
        fileName, 
        fileId 
      });
      
      return fileId;
    } catch (error) {
      this.logger.error('Error generating and uploading text file', error, {
        fileName,
        contentLength: content.length,
        channelId
      });
      throw error;
    }
  }

  /**
   * Generate and upload a CSV file to Mattermost
   */
  async generateAndUploadCSV(channelId: string, data: any[], fileName: string, postId?: string): Promise<string> {
    try {
      this.logger.info('Generating and uploading CSV file', { 
        fileName, 
        rowCount: data.length,
        channelId 
      });
      
      // Check if data is valid
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Invalid data for CSV generation: data must be a non-empty array');
      }
      
      // Get headers from first row
      const headers = Object.keys(data[0]);
      if (headers.length === 0) {
        throw new Error('Invalid data for CSV generation: first row must have at least one property');
      }
      
      // Generate CSV content
      let csvContent = headers.join(',') + '\n';
      
      for (const row of data) {
        const values = headers.map(header => {
          const value = row[header];
          // Handle null/undefined values
          if (value === null || value === undefined) {
            return '';
          }
          // Handle values with commas, quotes, or newlines by quoting and escaping
          const strValue = String(value);
          if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
            return `"${strValue.replace(/"/g, '""')}"`;
          }
          return strValue;
        });
        csvContent += values.join(',') + '\n';
      }
      
      // Create file buffer
      const fileData = Buffer.from(csvContent, 'utf-8');
      
      // Upload file
      const fileId = await this.uploadFile(channelId, fileData, fileName, postId);
      
      // Post message with file attachment and summary
      const summary = `Generated CSV file: ${fileName}\n- ${data.length} rows\n- ${headers.length} columns: ${headers.join(', ')}`;
      await this.restClient.createPost(channelId, summary, {
        rootId: postId,
        fileIds: [fileId]
      });
      
      this.logger.info('CSV file generated and uploaded successfully', { 
        fileName, 
        fileId,
        rowCount: data.length,
        columnCount: headers.length
      });
      
      return fileId;
    } catch (error) {
      this.logger.error('Error generating and uploading CSV file', error, {
        fileName,
        rowCount: data?.length,
        channelId
      });
      throw error;
    }
  }

  /**
   * Generate and upload a markdown report to Mattermost
   */
  async generateAndUploadMarkdownReport(channelId: string, title: string, content: string, postId?: string): Promise<string> {
    try {
      this.logger.info('Generating and uploading markdown report', { 
        title, 
        contentLength: content.length,
        channelId 
      });
      
      // Generate markdown content with proper formatting
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const markdown = `# ${title}\n\n*Generated on: ${new Date().toLocaleString()}*\n\n${content}`;
      
      // Create file name
      const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${timestamp}.md`;
      
      // Create file buffer
      const fileData = Buffer.from(markdown, 'utf-8');
      
      // Upload file
      const fileId = await this.uploadFile(channelId, fileData, fileName, postId);
      
      // Post message with file attachment
      const summary = `Generated markdown report: **${title}**\nFile: ${fileName}`;
      await this.restClient.createPost(channelId, summary, {
        rootId: postId,
        fileIds: [fileId]
      });
      
      this.logger.info('Markdown report generated and uploaded successfully', { 
        title,
        fileName,
        fileId 
      });
      
      return fileId;
    } catch (error) {
      this.logger.error('Error generating and uploading markdown report', error, {
        title,
        contentLength: content.length,
        channelId
      });
      throw error;
    }
  }

  /**
   * Generate and upload a JSON file to Mattermost
   */
  async generateAndUploadJSON(channelId: string, data: any, fileName: string, postId?: string): Promise<string> {
    try {
      this.logger.info('Generating and uploading JSON file', { 
        fileName, 
        channelId 
      });
      
      // Convert data to formatted JSON
      const jsonContent = JSON.stringify(data, null, 2);
      
      // Create file buffer
      const fileData = Buffer.from(jsonContent, 'utf-8');
      
      // Upload file
      const fileId = await this.uploadFile(channelId, fileData, fileName, postId);
      
      // Post message with file attachment
      const summary = `Generated JSON file: ${fileName}\nSize: ${this.formatFileSize(fileData.length)}`;
      await this.restClient.createPost(channelId, summary, {
        rootId: postId,
        fileIds: [fileId]
      });
      
      this.logger.info('JSON file generated and uploaded successfully', { 
        fileName, 
        fileId 
      });
      
      return fileId;
    } catch (error) {
      this.logger.error('Error generating and uploading JSON file', error, {
        fileName,
        channelId
      });
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